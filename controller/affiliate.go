package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func affiliateTarget(c *gin.Context) (int, bool) {
	if c.Param("id") == "" {
		return c.GetInt("id"), true
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return 0, false
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("No permission to update users of same or higher permission level"))
		return 0, false
	}
	return id, true
}

func GetAffiliate(c *gin.Context) {
	id, ok := affiliateTarget(c)
	if !ok {
		return
	}
	summary, err := model.GetAffiliateSummary(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetAffiliateHistory(c *gin.Context) {
	id, ok := affiliateTarget(c)
	if !ok {
		return
	}
	page := common.GetPageQuery(c)
	entries, total, err := model.GetAffiliateEntries(id, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(entries)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func GetAffiliateInvitees(c *gin.Context) {
	id, ok := affiliateTarget(c)
	if !ok {
		return
	}
	page := common.GetPageQuery(c)
	var total int64
	users := make([]struct {
		ID          int    `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
	}, 0)
	query := model.DB.Model(&model.User{}).Where("inviter_id = ?", id)
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := query.Select("id", "username", "display_name").Order("id desc").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&users).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(users)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func ManageAffiliate(c *gin.Context) {
	id, ok := affiliateTarget(c)
	if !ok {
		return
	}
	var action model.AffiliateAction
	if err := common.DecodeJson(c.Request.Body, &action); err != nil || action.UserID != id || action.Validate() != nil {
		common.ApiErrorT(c, "Invalid referral settings")
		return
	}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them.")
		return
	}
	if requireAdminUserProof(c, service.VerificationScopeAdminUserAffiliate, action.VerificationContext()) == nil {
		return
	}
	var err error
	switch action.Action {
	case "settings":
		err = model.SetAffiliateSettings(id, action.InviterID, action.RateBPS, c.GetInt("id"), c.GetInt("role"))
	case "withdrawal":
		_, err = model.WithdrawAffiliate(id, c.GetInt("id"), c.GetInt("role"), action.AmountCents, action.ExpectedPaidCents, action.RequestID, action.Note)
	case "reversal":
		err = model.ReverseAffiliateOrder(id, c.GetInt("id"), c.GetInt("role"), action.TradeNo, action.Note)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "User or referral order does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, id, "user.affiliate."+action.Action, action.VerificationContext())
	common.ApiSuccess(c, nil)
}
