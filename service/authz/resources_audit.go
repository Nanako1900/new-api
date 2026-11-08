package authz

const ResourceAudit = "audit"

var AuditRead = Permission{Resource: ResourceAudit, Action: ActionRead}

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceAudit,
		LabelKey: "Audit Logs",
		Actions: []ActionDefinition{{
			Action:         ActionRead,
			LabelKey:       "View other accounts' audit and content safety logs",
			DescriptionKey: "View audit records and content safety records (including excerpts of users' prompts) from user and admin roles. Root records are always excluded.",
		}},
	})
}
