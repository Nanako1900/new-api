package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// cacheSubsidyCampaignId reads the :id path parameter and writes the error
// response when it is not a campaign id.
func cacheSubsidyCampaignId(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	return id, true
}

func respondCacheSubsidyCampaign(c *gin.Context, id int) {
	campaign, err := model.GetCacheSubsidyCampaign(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views, err := model.CacheSubsidyCampaignViews([]*model.CacheSubsidyCampaign{campaign})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, views[0])
}

func AdminListCacheSubsidyCampaigns(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	campaigns, total, err := model.ListCacheSubsidyCampaigns(c.Query("keyword"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views, err := model.CacheSubsidyCampaignViews(campaigns)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

func AdminGetCacheSubsidyCampaign(c *gin.Context) {
	id, ok := cacheSubsidyCampaignId(c)
	if !ok {
		return
	}
	respondCacheSubsidyCampaign(c, id)
}

func AdminCreateCacheSubsidyCampaign(c *gin.Context) {
	var input model.CacheSubsidyCampaignInput
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	campaign, err := model.CreateCacheSubsidyCampaign(input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	respondCacheSubsidyCampaign(c, campaign.Id)
}

func AdminUpdateCacheSubsidyCampaign(c *gin.Context) {
	id, ok := cacheSubsidyCampaignId(c)
	if !ok {
		return
	}
	var input model.CacheSubsidyCampaignInput
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.UpdateCacheSubsidyCampaign(id, input); err != nil {
		common.ApiError(c, err)
		return
	}
	respondCacheSubsidyCampaign(c, id)
}

func AdminDeleteCacheSubsidyCampaign(c *gin.Context) {
	id, ok := cacheSubsidyCampaignId(c)
	if !ok {
		return
	}
	if err := model.DeleteCacheSubsidyCampaign(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminCacheSubsidyCampaignAction runs a lifecycle action named by the last
// path segment: calculate, reset, open or close.
func AdminCacheSubsidyCampaignAction(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := cacheSubsidyCampaignId(c)
		if !ok {
			return
		}
		now := common.GetTimestamp()
		var err error
		switch action {
		case "calculate":
			err = service.QueueCacheSubsidyCalculation(id)
		case "reset":
			err = model.ResetCacheSubsidyCampaign(id)
		case "open":
			err = model.OpenCacheSubsidyCampaign(id, now)
		case "close":
			err = model.CloseCacheSubsidyCampaign(id, now)
		default:
			err = model.ErrCacheSubsidyBadStatus
		}
		if err != nil {
			common.ApiError(c, err)
			return
		}
		respondCacheSubsidyCampaign(c, id)
	}
}

func AdminListCacheSubsidyGrants(c *gin.Context) {
	id, ok := cacheSubsidyCampaignId(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	grants, total, err := model.ListCacheSubsidyGrants(id, c.Query("keyword"), c.Query("status"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(grants)
	common.ApiSuccess(c, pageInfo)
}

func GetUserCacheSubsidies(c *gin.Context) {
	items, err := model.ListUserCacheSubsidies(c.GetInt("id"), common.GetTimestamp())
	if err != nil {
		common.SysError(common.LogText("failed to list cache subsidies: %s", err.Error()))
		common.ApiError(c, model.ErrCacheSubsidyUnavailable)
		return
	}
	common.ApiSuccess(c, items)
}

type claimCacheSubsidyRequest struct {
	CampaignId int `json:"campaign_id"`
}

// ClaimUserCacheSubsidy credits the caller's subsidy of one campaign. The
// captcha gate recorded the request as a claim; it is withdrawn when nothing
// was credited.
func ClaimUserCacheSubsidy(c *gin.Context) {
	var req claimCacheSubsidyRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.CampaignId <= 0 {
		middleware.WithdrawCaptchaRisk(c)
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	quota, err := model.ClaimCacheSubsidy(req.CampaignId, c.GetInt("id"), common.GetTimestamp())
	if err != nil {
		middleware.WithdrawCaptchaRisk(c)
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"quota": quota})
}
