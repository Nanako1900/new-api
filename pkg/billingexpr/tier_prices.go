package billingexpr

import (
	"errors"
	"fmt"
	"maps"

	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/parser"
)

// TierPrices is the linear token pricing of one tier: the $/1M coefficient
// of every token variable the tier body references, as the log detail view
// reads it.
type TierPrices struct {
	Unit map[string]float64
	// HasRequestRules reports request-dependent multipliers (param, header or
	// time conditions) outside the tier; their outcome is only known from a
	// request's logged rule trace.
	HasRequestRules bool
}

var tierPriceVars = map[string]bool{
	"p": true, "c": true, "cr": true, "cc": true, "cc1h": true, "cc12h": true,
	"img": true, "img_cr": true, "img_o": true, "ai": true, "ao": true,
}

var errTierNotLinear = errors.New("tier body is not a linear token price")

// TierUnitPrices returns the token prices of the tier named label. An empty
// label selects the only tier of a single-tier expression. Between the root
// and the tier only branch-selecting conditionals and traced request
// multipliers (`request condition ? N : 1`) may appear, so the prices are
// exactly what the request paid once the logged rule trace is applied. Tier
// bodies must be sums of token variables times constants; fixed prices,
// conditionals, function calls and products of variables are rejected.
func TierUnitPrices(exprStr string, label string) (TierPrices, error) {
	_, body := ParseExprVersion(exprStr)
	tree, err := parser.Parse(body)
	if err != nil {
		return TierPrices{}, err
	}

	labels := map[string]bool{}
	ast.Find(tree.Node, func(node ast.Node) bool {
		if name, ok := tierCallLabel(node); ok {
			labels[name] = true
		}
		return false
	})
	if label == "" && len(labels) > 1 {
		return TierPrices{}, fmt.Errorf("expression has %d tiers and no tier was named", len(labels))
	}

	bodies, err := matchedTierBodies(tree.Node, label)
	if err != nil {
		return TierPrices{}, err
	}
	if len(bodies) == 0 {
		return TierPrices{}, fmt.Errorf("tier %q not found", label)
	}

	var unit map[string]float64
	for _, node := range bodies {
		prices, _, err := linearTokenPrices(node)
		if err != nil {
			return TierPrices{}, err
		}
		// Branches may repeat a label (for example per time window); they
		// only identify one price list when every copy agrees.
		if unit != nil && !maps.Equal(unit, prices) {
			return TierPrices{}, fmt.Errorf("tier %q has conflicting prices", label)
		}
		unit = prices
	}

	hasRequestRules := ast.Find(tree.Node, func(node ast.Node) bool {
		conditional, ok := node.(*ast.ConditionalNode)
		if !ok {
			return false
		}
		_, traced := tracedRequestRule(conditional)
		return traced
	}) != nil
	return TierPrices{Unit: unit, HasRequestRules: hasRequestRules}, nil
}

func tierCallLabel(node ast.Node) (string, bool) {
	call, ok := node.(*ast.CallNode)
	if !ok || len(call.Arguments) != 2 {
		return "", false
	}
	callee, ok := call.Callee.(*ast.IdentifierNode)
	name, nameOK := call.Arguments[0].(*ast.StringNode)
	if !ok || callee.Value != "tier" || !nameOK {
		return "", false
	}
	return name.Value, true
}

// matchedTierBodies returns the bodies of the tier calls named label that
// the expression's value can come from, or an error when such a call is
// combined with anything that would change its prices.
func matchedTierBodies(node ast.Node, label string) ([]ast.Node, error) {
	if name, ok := tierCallLabel(node); ok {
		if label == "" || name == label {
			return []ast.Node{node.(*ast.CallNode).Arguments[1]}, nil
		}
		return nil, nil
	}
	switch n := node.(type) {
	case *ast.ConditionalNode:
		if _, traced := tracedRequestRule(n); traced {
			return nil, nil
		}
		// An unnamed tier may sit in one branch while the request took the
		// other, so only a named tier can be located through a branch.
		if label != "" {
			left, err := matchedTierBodies(n.Exp1, label)
			if err != nil {
				return nil, err
			}
			right, err := matchedTierBodies(n.Exp2, label)
			if err != nil {
				return nil, err
			}
			return append(left, right...), nil
		}
	case *ast.BinaryNode:
		if n.Operator == "*" {
			if factor, ok := n.Right.(*ast.ConditionalNode); ok {
				if _, traced := tracedRequestRule(factor); traced {
					return matchedTierBodies(n.Left, label)
				}
			}
			if factor, ok := n.Left.(*ast.ConditionalNode); ok {
				if _, traced := tracedRequestRule(factor); traced {
					return matchedTierBodies(n.Right, label)
				}
			}
		}
	}
	if ast.Find(node, func(child ast.Node) bool {
		name, ok := tierCallLabel(child)
		return ok && (label == "" || name == label)
	}) != nil {
		return nil, fmt.Errorf("tier %q is combined with other terms: %w", label, errTierNotLinear)
	}
	return nil, nil
}

// linearTokenPrices reduces node to coefficients per token variable plus a
// constant term.
func linearTokenPrices(node ast.Node) (map[string]float64, float64, error) {
	switch n := node.(type) {
	case *ast.IntegerNode:
		return map[string]float64{}, float64(n.Value), nil
	case *ast.FloatNode:
		return map[string]float64{}, n.Value, nil
	case *ast.IdentifierNode:
		if !tierPriceVars[n.Value] {
			return nil, 0, errTierNotLinear
		}
		return map[string]float64{n.Value: 1}, 0, nil
	case *ast.UnaryNode:
		prices, constant, err := linearTokenPrices(n.Node)
		if err != nil {
			return nil, 0, err
		}
		switch n.Operator {
		case "+":
			return prices, constant, nil
		case "-":
			return scaleTokenPrices(prices, -1), -constant, nil
		}
	case *ast.BinaryNode:
		left, leftConst, err := linearTokenPrices(n.Left)
		if err != nil {
			return nil, 0, err
		}
		right, rightConst, err := linearTokenPrices(n.Right)
		if err != nil {
			return nil, 0, err
		}
		switch n.Operator {
		case "+", "-":
			sign := 1.0
			if n.Operator == "-" {
				sign = -1
			}
			sum := maps.Clone(left)
			for name, coef := range right {
				sum[name] += sign * coef
			}
			return sum, leftConst + sign*rightConst, nil
		case "*":
			if len(left) == 0 {
				return scaleTokenPrices(right, leftConst), leftConst * rightConst, nil
			}
			if len(right) == 0 {
				return scaleTokenPrices(left, rightConst), leftConst * rightConst, nil
			}
		case "/":
			if len(right) == 0 && rightConst != 0 {
				return scaleTokenPrices(left, 1/rightConst), leftConst / rightConst, nil
			}
		}
	}
	return nil, 0, errTierNotLinear
}

func scaleTokenPrices(prices map[string]float64, factor float64) map[string]float64 {
	scaled := make(map[string]float64, len(prices))
	for name, coef := range prices {
		scaled[name] = coef * factor
	}
	return scaled
}
