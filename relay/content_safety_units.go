package relay

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service/contentsafety"
)

// reviewsByMessage reports whether requestReviewMessages reads request by
// message. Other formats are reviewed as one text built from CombineText.
func reviewsByMessage(request dto.Request) bool {
	switch request.(type) {
	case *dto.GeneralOpenAIRequest, *dto.ClaudeRequest, *dto.OpenAIResponsesRequest, *dto.GeminiChatRequest:
		return true
	}
	return false
}

// requestReviewMessages lists the text a model reads from request, one entry
// per message in conversation order, for the AI review. Tool, function and
// schema definitions form one leading meta entry. Tool results are left out
// unless includeToolResults is set; the history a client sends is its own,
// so leaving them out lets anything labelled as a tool result through.
// Formats without messages give one meta entry of their scan text.
func requestReviewMessages(request dto.Request, combineText string, includeToolResults bool) []contentsafety.Message {
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		return openAIReviewMessages(r, includeToolResults)
	case *dto.ClaudeRequest:
		return claudeReviewMessages(r, includeToolResults)
	case *dto.OpenAIResponsesRequest:
		return responsesReviewMessages(r, includeToolResults)
	case *dto.GeminiChatRequest:
		return geminiReviewMessages(r, includeToolResults)
	}
	return []contentsafety.Message{{Role: contentsafety.RoleMeta, Text: requestScanText(request, combineText)}}
}

func joinText(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, "\n")
}

// marshalledText is the decoded text of value encoded as JSON, for typed
// members such as tool definitions.
func marshalledText(value any) string {
	encoded, err := common.Marshal(value)
	if err != nil {
		return ""
	}
	return contentsafety.CollectJSONText(encoded)
}

func openAIReviewMessages(r *dto.GeneralOpenAIRequest, includeToolResults bool) []contentsafety.Message {
	meta := []string{contentsafety.CollectJSONText(r.Functions), contentsafety.CollectJSONText(r.Prediction)}
	if len(r.Tools) > 0 {
		meta = append(meta, marshalledText(r.Tools))
	}
	if r.ResponseFormat != nil {
		meta = append(meta, contentsafety.CollectJSONText(r.ResponseFormat.JsonSchema))
	}
	messages := []contentsafety.Message{}
	for _, message := range r.Messages {
		meta = append(meta, contentsafety.CollectJSONText(message.Tools))
	}
	messages = append(messages, contentsafety.Message{Role: contentsafety.RoleMeta, Text: joinText(meta...)})
	// Completions, edits and similar endpoints carry their text outside messages.
	messages = append(messages, contentsafety.Message{Role: contentsafety.RoleUser, Text: joinText(
		contentsafety.CollectValueText(r.Prompt), contentsafety.CollectValueText(r.Suffix),
		contentsafety.CollectValueText(r.Input), r.Instruction)})
	for _, message := range r.Messages {
		role := chatRole(message.Role)
		if role == contentsafety.RoleTool && !includeToolResults {
			continue
		}
		reasoning := ""
		if message.ReasoningContent != nil {
			reasoning = *message.ReasoningContent
		} else if message.Reasoning != nil {
			reasoning = *message.Reasoning
		}
		messages = append(messages, contentsafety.Message{Role: role, Text: joinText(
			message.StringContent(), reasoning, contentsafety.CollectJSONText(message.ToolCalls))})
	}
	return messages
}

// chatRole maps a chat or Responses role onto a review unit role.
func chatRole(role string) string {
	switch role {
	case "system", "developer":
		return contentsafety.RoleSystem
	case "assistant", "model":
		return contentsafety.RoleAssistant
	case "tool", "function":
		return contentsafety.RoleTool
	}
	return contentsafety.RoleUser
}

func claudeReviewMessages(r *dto.ClaudeRequest, includeToolResults bool) []contentsafety.Message {
	// Token counting reads the tool definitions; system and messages are read
	// from their decoded blocks below.
	counted := *r
	counted.System, counted.Messages = nil, nil
	messages := []contentsafety.Message{
		{Role: contentsafety.RoleMeta, Text: counted.GetTokenCountMeta().CombineText},
		{Role: contentsafety.RoleUser, Text: r.Prompt},
		{Role: contentsafety.RoleSystem, Text: joinText(claudeContentText(r.System, true)...)},
	}
	for _, message := range r.Messages {
		messages = append(messages, contentsafety.Message{Role: chatRole(message.Role), Text: joinText(claudeContentText(message.Content, includeToolResults)...)})
	}
	return messages
}

func responsesReviewMessages(r *dto.OpenAIResponsesRequest, includeToolResults bool) []contentsafety.Message {
	instructions := contentsafety.CollectJSONText(r.Instructions)
	if common.GetJsonType(r.Instructions) == "string" {
		_ = common.Unmarshal(r.Instructions, &instructions)
	}
	messages := []contentsafety.Message{
		{Role: contentsafety.RoleMeta, Text: joinText(contentsafety.CollectJSONText(r.Tools), contentsafety.CollectJSONText(r.Text),
			contentsafety.CollectJSONText(r.Prompt), contentsafety.CollectJSONText(r.Metadata))},
		{Role: contentsafety.RoleSystem, Text: instructions},
	}
	var input any
	if len(r.Input) == 0 || common.Unmarshal(r.Input, &input) != nil {
		return messages
	}
	items, isList := input.([]any)
	if !isList {
		return append(messages, contentsafety.Message{Role: contentsafety.RoleUser, Text: contentsafety.CollectValueText(input)})
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		role, text := responsesItemText(item)
		if role == contentsafety.RoleTool && !includeToolResults {
			continue
		}
		messages = append(messages, contentsafety.Message{Role: role, Text: text})
	}
	return messages
}

// responsesItemText is the role and text of one Responses input item: the
// text parts of a message, the name and arguments of a call, the output of a
// call result, and the decoded strings of anything else.
func responsesItemText(item map[string]any) (string, string) {
	itemType, _ := item["type"].(string)
	switch {
	case itemType == "function_call_output" || itemType == "custom_tool_call_output" || strings.HasSuffix(itemType, "_call_output"):
		return contentsafety.RoleTool, contentsafety.CollectValueText(item["output"])
	case itemType == "function_call" || itemType == "custom_tool_call":
		name, _ := item["name"].(string)
		return contentsafety.RoleAssistant, joinText(name, contentsafety.CollectValueText(item["arguments"]), contentsafety.CollectValueText(item["input"]))
	case itemType == "" || itemType == "message":
		role, _ := item["role"].(string)
		content := item["content"]
		if text, ok := content.(string); ok {
			return chatRole(role), text
		}
		parts, _ := content.([]any)
		var texts []string
		for _, rawPart := range parts {
			part, _ := rawPart.(map[string]any)
			if text, ok := part["text"].(string); ok {
				texts = append(texts, text)
			}
		}
		return chatRole(role), joinText(texts...)
	}
	return contentsafety.RoleMeta, contentsafety.CollectValueText(item)
}

func geminiReviewMessages(r *dto.GeminiChatRequest, includeToolResults bool) []contentsafety.Message {
	messages := []contentsafety.Message{{Role: contentsafety.RoleMeta, Text: contentsafety.CollectJSONText(r.Tools)}}
	if r.SystemInstructions != nil {
		system, _ := geminiPartsText(r.SystemInstructions.Parts)
		messages = append(messages, contentsafety.Message{Role: contentsafety.RoleSystem, Text: system})
	}
	for _, content := range r.Contents {
		text, results := geminiPartsText(content.Parts)
		messages = append(messages, contentsafety.Message{Role: chatRole(content.Role), Text: text})
		if includeToolResults {
			messages = append(messages, contentsafety.Message{Role: contentsafety.RoleTool, Text: results})
		}
	}
	for i := range r.Requests {
		messages = append(messages, geminiReviewMessages(&r.Requests[i], includeToolResults)...)
	}
	return messages
}

// geminiPartsText is the text of Gemini parts a model reads, and apart from
// it the text of their function responses. Inline and file data are media.
func geminiPartsText(parts []dto.GeminiPart) (string, string) {
	var texts, results []string
	for _, part := range parts {
		texts = append(texts, part.Text)
		if part.FunctionCall != nil {
			texts = append(texts, part.FunctionCall.FunctionName, contentsafety.CollectValueText(part.FunctionCall.Arguments))
		}
		if part.ExecutableCode != nil {
			texts = append(texts, marshalledText(part.ExecutableCode))
		}
		if part.CodeExecutionResult != nil {
			results = append(results, marshalledText(part.CodeExecutionResult))
		}
		if part.FunctionResponse != nil {
			results = append(results, part.FunctionResponse.Name, contentsafety.CollectValueText(part.FunctionResponse.Response),
				contentsafety.CollectJSONText(part.FunctionResponse.Parts))
		}
	}
	return joinText(texts...), joinText(results...)
}
