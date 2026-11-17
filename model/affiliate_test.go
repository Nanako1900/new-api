package model

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestAffiliateDatabaseMatrix(t *testing.T) {
	engines := []struct{ name, dsn string }{{"sqlite", ""}, {"mysql", os.Getenv("AFF_TEST_MYSQL_DSN")}, {"postgres", os.Getenv("AFF_TEST_POSTGRES_DSN")}}
	for _, engine := range engines {
		for _, upgrade := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/upgrade=%t", engine.name, upgrade), func(t *testing.T) {
				if engine.name != "sqlite" && engine.dsn == "" {
					t.Skip("set AFF_TEST_MYSQL_DSN and AFF_TEST_POSTGRES_DSN for the real database matrix")
				}
				var dialector gorm.Dialector
				switch engine.name {
				case "mysql":
					dialector = mysql.Open(engine.dsn)
				case "postgres":
					dialector = postgres.Open(engine.dsn)
				default:
					dialector = sqlite.Open(filepath.Join(t.TempDir(), "affiliate.db"))
				}
				db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
				require.NoError(t, err)
				var version string
				versionQuery := "SELECT version()"
				if engine.name == "sqlite" {
					versionQuery = "SELECT sqlite_version()"
				}
				require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
				t.Logf("database version: %s", version)
				originalDB, originalLogDB := DB, LOG_DB
				originalMain, originalLog := common.MainDatabaseType(), common.LogDatabaseType()
				payment := operation_setting.GetPaymentSetting()
				originalPayment, originalFX := *payment, operation_setting.USDExchangeRate
				DB = db
				logDB, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "logs.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
				require.NoError(t, err)
				LOG_DB = logDB
				require.NoError(t, logDB.AutoMigrate(&Log{}))
				databaseType := common.DatabaseTypeSQLite
				if engine.name == "mysql" {
					databaseType = common.DatabaseTypeMySQL
				}
				if engine.name == "postgres" {
					databaseType = common.DatabaseTypePostgreSQL
				}
				common.SetDatabaseTypes(databaseType, common.DatabaseTypeSQLite)
				initCol()
				payment.ComplianceConfirmed, payment.ComplianceTermsVersion = true, operation_setting.CurrentComplianceTermsVersion
				operation_setting.USDExchangeRate = 7
				sqlDB, err := db.DB()
				require.NoError(t, err)
				if engine.name == "sqlite" {
					sqlDB.SetMaxOpenConns(1)
				}
				t.Cleanup(func() {
					DB, LOG_DB = originalDB, originalLogDB
					common.SetDatabaseTypes(originalMain, originalLog)
					initCol()
					*payment = originalPayment
					operation_setting.USDExchangeRate = originalFX
					require.NoError(t, sqlDB.Close())
					logs, err := logDB.DB()
					require.NoError(t, err)
					require.NoError(t, logs.Close())
				})
				// These DSNs must point at disposable databases; only this fixture's tables are replaced.
				require.NoError(t, db.Migrator().DropTable(&AffiliateEntry{}, &AffiliateOrder{}, &AffiliateChange{}, &AffiliateAccount{}, &AffiliateGraphLock{}, &TopUp{}, &User{}))
				if upgrade {
					require.NoError(t, db.Table("users").AutoMigrate(&affiliateReleasedUser{}))
					require.NoError(t, db.Table("top_ups").AutoMigrate(&affiliateReleasedTopUp{}))
					require.NoError(t, db.Table("users").Create(&affiliateReleasedUser{Id: 99, Username: "legacy", Password: "stored-hash", AffCode: "legacy", Quota: 123456, AffQuota: 900, AffHistoryQuota: 1000, InviterId: 100}).Error)
					require.NoError(t, db.Table("top_ups").Create(&affiliateReleasedTopUp{Id: 99, UserId: 99, Amount: 1, Money: 20, TradeNo: "legacy-paid", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusSuccess}).Error)
				} else {
					require.NoError(t, db.AutoMigrate(&User{}))
				}
				for range 2 {
					require.NoError(t, db.AutoMigrate(&TopUp{}, &AffiliateAccount{}, &AffiliateOrder{}, &AffiliateEntry{}, &AffiliateChange{}, &AffiliateGraphLock{}))
				}
				if upgrade {
					var user User
					require.NoError(t, db.First(&user, 99).Error)
					assert.Equal(t, 123456, user.Quota)
					assert.Equal(t, 900, user.AffQuota)
					assert.Equal(t, 1000, user.AffHistoryQuota)
					assert.Equal(t, 100, user.InviterId)
					assert.False(t, GetTopUpByTradeNo("legacy-paid").AffiliateEligible)
					err := db.Create(&User{Id: 98, Username: "unique-test", AffCode: "legacy"}).Error
					require.Error(t, err)
				}
				for _, user := range []User{{Id: 100, Username: "A", AffCode: "A", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 900}, {Id: 101, Username: "B", AffCode: "B", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}, {Id: 102, Username: "C", AffCode: "C", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}} {
					require.NoError(t, db.Create(&user).Error)
				}
				require.NoError(t, SetAffiliateSettings(100, 0, 1000, 1, common.RoleRootUser))
				require.NoError(t, SetAffiliateSettings(101, 100, 0, 1, common.RoleRootUser))
				require.ErrorIs(t, SetAffiliateSettings(100, 101, 1000, 1, common.RoleRootUser), ErrAffiliateCycle)
				require.ErrorIs(t, SetAffiliateSettings(101, 101, 0, 1, common.RoleRootUser), ErrAffiliateCycle)
				require.Error(t, SetAffiliateSettings(101, 88888, 0, 1, common.RoleRootUser))
				require.ErrorIs(t, SetAffiliateSettings(100, 0, 10001, 1, common.RoleRootUser), ErrAffiliateSettings)
				require.ErrorIs(t, SetAffiliateSettings(100, 0, 1000, 101, common.RoleCommonUser), ErrUserQuotaPermission)
				t.Run("payment providers and snapshots", testAffiliatePayments)
				t.Run("GBP CNY recharge and fee snapshot", testAffiliateGBPRecharge)
				t.Run("withdrawal and reversal", testAffiliateWithdrawal)
				t.Run("concurrent duplicate callback", testAffiliateConcurrentCallback)
				t.Run("ledger rollback and eligibility", testAffiliateAccountingBoundaries)
				t.Run("competing payouts", testAffiliateConcurrentPayout)
				t.Run("deleted inviter", testAffiliateDeletedInviter)
				t.Run("duplicate payout after concurrent commit", testAffiliatePayoutConcurrentRetry)
				var inviter User
				require.NoError(t, db.First(&inviter, 100).Error)
				assert.Equal(t, 900, inviter.Quota, "cashback never changes consumption quota")
				assert.Zero(t, inviter.AffQuota, "cashback never changes registration gifts")
				if upgrade {
					duplicate := TopUp{UserId: 101, TradeNo: "legacy-paid"}
					require.Error(t, db.Create(&duplicate).Error)
				}
			})
		}
	}
}

func testAffiliatePayments(t *testing.T) {
	providers := []string{PaymentProviderEpay, PaymentProviderStripe, PaymentProviderCreem, PaymentProviderWaffo, PaymentProviderWaffoPancake}
	for _, provider := range providers {
		t.Run(provider, func(t *testing.T) {
			order := TopUp{UserId: 101, Amount: 2, Money: 20, TradeNo: "cashback-" + provider, PaymentProvider: provider, PaymentMethod: provider, Status: common.TopUpStatusPending, AffiliateCurrency: "USD"}
			payment := AffiliatePayment{Amount: "20.00", Currency: "USD"}
			want := int64(1400)
			if provider == PaymentProviderEpay {
				order.AffiliateCurrency, payment.Currency = "CNY", "CNY"
				want = 200
			}
			if provider == PaymentProviderStripe {
				order.AffiliateFeeCents = 100
				want = 1330
			}
			require.NoError(t, order.Insert())
			before, err := GetAffiliateSummary(100)
			require.NoError(t, err)
			// A later relationship, ratio, and FX change cannot move/reprice this order.
			require.NoError(t, SetAffiliateSettings(101, 102, 0, 1, common.RoleRootUser))
			require.NoError(t, SetAffiliateSettings(100, 0, 5000, 1, common.RoleRootUser))
			operation_setting.USDExchangeRate = 8
			var pay func(AffiliatePayment) error
			switch provider {
			case PaymentProviderEpay:
				pay = func(p AffiliatePayment) error { _, err := RechargeEpay(order.TradeNo, "alipay", "", p); return err }
			case PaymentProviderStripe:
				pay = func(p AffiliatePayment) error { return Recharge(order.TradeNo, "", "", p) }
			case PaymentProviderCreem:
				pay = func(p AffiliatePayment) error { return RechargeCreem(order.TradeNo, "", "", "", p) }
			case PaymentProviderWaffo:
				pay = func(p AffiliatePayment) error { return RechargeWaffo(order.TradeNo, "", p) }
			default:
				pay = func(p AffiliatePayment) error { return RechargeWaffoPancake(order.TradeNo, p) }
			}
			for _, bad := range []AffiliatePayment{{Amount: "-1", Currency: payment.Currency}, {Amount: "1e1000000000", Currency: payment.Currency}, {Amount: "999999999999999999999", Currency: payment.Currency}, {Amount: "1.001", Currency: payment.Currency}, {Amount: "20", Currency: "EUR"}} {
				require.Error(t, pay(bad))
				assert.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo(order.TradeNo).Status)
			}
			require.NoError(t, pay(payment))
			_ = pay(payment) // providers differ in duplicate acknowledgement, but accounting is identical.
			after, err := GetAffiliateSummary(100)
			require.NoError(t, err)
			assert.Equal(t, before.BalanceCents+want, after.BalanceCents)
			var count int64
			require.NoError(t, DB.Model(&AffiliateEntry{}).Where("trade_no = ?", order.TradeNo).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			require.NoError(t, SetAffiliateSettings(100, 0, 1000, 1, common.RoleRootUser))
			require.NoError(t, SetAffiliateSettings(101, 100, 0, 1, common.RoleRootUser))
			operation_setting.USDExchangeRate = 7
		})
	}
	// Manual completion requires verified money for eligible orders and uses Creem's quota units.
	manual := TopUp{UserId: 101, Amount: 123, Money: 10, TradeNo: "cashback-manual", PaymentProvider: PaymentProviderCreem, Status: common.TopUpStatusPending, AffiliateCurrency: "CNY"}
	require.NoError(t, manual.Insert())
	require.Error(t, ManualCompleteTopUp(manual.TradeNo, ""))
	var buyer User
	require.NoError(t, DB.First(&buyer, 101).Error)
	before := buyer.Quota
	require.NoError(t, ManualCompleteTopUp(manual.TradeNo, "", AffiliatePayment{Amount: "10.00", Currency: "CNY"}))
	require.NoError(t, DB.First(&buyer, 101).Error)
	assert.Equal(t, before+123, buyer.Quota)
	legacy := TopUp{UserId: 101, Amount: 1, TradeNo: "legacy-pending", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
	require.NoError(t, DB.Create(&legacy).Error)
	require.NoError(t, ManualCompleteTopUp(legacy.TradeNo, ""))
	var count int64
	require.NoError(t, DB.Model(&AffiliateEntry{}).Where("trade_no = ?", legacy.TradeNo).Count(&count).Error)
	assert.Zero(t, count)
}

func testAffiliateWithdrawal(t *testing.T) {
	before, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	requestID := uuid.NewString()
	// A credit arriving after the admin preview must survive the withdrawal.
	newOrder := TopUp{UserId: 101, Amount: 1, Money: 10, TradeNo: "during-withdrawal", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending, AffiliateCurrency: "CNY"}
	require.NoError(t, newOrder.Insert())
	_, err = RechargeEpay(newOrder.TradeNo, "", "", AffiliatePayment{Amount: "10.00", Currency: "CNY"})
	require.NoError(t, err)
	entry, err := WithdrawAffiliate(100, 1, common.RoleRootUser, before.BalanceCents, before.PaidCents, requestID, "bank receipt 123")
	require.NoError(t, err)
	assert.EqualValues(t, 100, entry.BalanceAfter)
	again, err := WithdrawAffiliate(100, 1, common.RoleRootUser, before.BalanceCents, before.PaidCents, requestID, "bank receipt 123")
	require.NoError(t, err)
	assert.Equal(t, entry.ID, again.ID)
	_, err = WithdrawAffiliate(100, 1, common.RoleRootUser, 100, before.PaidCents, uuid.NewString(), "stale window")
	require.ErrorIs(t, err, ErrAffiliateBalance)
	after, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	_, err = WithdrawAffiliate(100, 1, common.RoleRootUser, 100, after.PaidCents, uuid.NewString(), "final payment")
	require.NoError(t, err)
	after, err = GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.Zero(t, after.BalanceCents)
	require.NoError(t, ReverseAffiliateOrder(100, 1, common.RoleRootUser, newOrder.TradeNo, "refunded by provider"))
	require.NoError(t, ReverseAffiliateOrder(100, 1, common.RoleRootUser, newOrder.TradeNo, "duplicate notification"))
	after, err = GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.EqualValues(t, -100, after.BalanceCents)
	assert.EqualValues(t, 100, after.ReversedCents)
	_, err = WithdrawAffiliate(100, 1, common.RoleRootUser, 1, after.PaidCents, uuid.NewString(), "invalid withdrawal")
	require.ErrorIs(t, err, ErrAffiliateBalance)
	_, err = WithdrawAffiliate(100, 101, common.RoleCommonUser, 1, after.PaidCents, uuid.NewString(), "forbidden")
	require.ErrorIs(t, err, ErrUserQuotaPermission)
}

func testAffiliateConcurrentCallback(t *testing.T) {
	order := TopUp{UserId: 101, Amount: 1, Money: 10, TradeNo: "duplicate-concurrent", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending, AffiliateCurrency: "CNY"}
	require.NoError(t, order.Insert())
	before, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			<-start
			_, err := RechargeEpay(order.TradeNo, "", "", AffiliatePayment{Amount: "10.00", Currency: "CNY"})
			outcomes <- err
		})
	}
	close(start)
	wg.Wait()
	close(outcomes)
	for err := range outcomes {
		require.NoError(t, err)
	}
	after, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.Equal(t, before.BalanceCents+100, after.BalanceCents)
}

func testAffiliateAccountingBoundaries(t *testing.T) {
	noReferral := TopUp{UserId: 102, Amount: 1, TradeNo: "no-referral", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
	require.NoError(t, noReferral.Insert())
	assert.False(t, noReferral.AffiliateEligible)
	_, err := RechargeEpay(noReferral.TradeNo, "", "")
	require.NoError(t, err)

	order := TopUp{UserId: 101, Amount: 1, TradeNo: "rollback-credit", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending, AffiliateCurrency: "CNY"}
	require.NoError(t, order.Insert())
	before, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	var buyer User
	require.NoError(t, DB.First(&buyer, 101).Error)
	// A ledger uniqueness failure must roll back both balances and order status.
	duplicate := AffiliateEntry{EventKey: "credit:" + order.TradeNo, UserID: 100}
	require.NoError(t, DB.Create(&duplicate).Error)
	_, err = RechargeEpay(order.TradeNo, "", "", AffiliatePayment{Amount: "0.05", Currency: "CNY"})
	require.Error(t, err)
	require.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo(order.TradeNo).Status)
	after, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.Equal(t, before.BalanceCents, after.BalanceCents)
	var unchanged User
	require.NoError(t, DB.First(&unchanged, 101).Error)
	assert.Equal(t, buyer.Quota, unchanged.Quota)
	require.NoError(t, DB.Delete(&duplicate).Error)
	_, err = RechargeEpay(order.TradeNo, "", "", AffiliatePayment{Amount: "0.05", Currency: "CNY"})
	require.NoError(t, err)
	after, err = GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.Equal(t, before.BalanceCents+1, after.BalanceCents, "half a cent rounds up once")

	invalid := TopUp{UserId: 101, Amount: 1, TradeNo: "unsupported-currency", AffiliateCurrency: "EUR"}
	require.ErrorIs(t, invalid.Insert(), ErrAffiliatePayment)
	assert.Nil(t, GetTopUpByTradeNo(invalid.TradeNo), "no orphaned order on snapshot failure")
}

func testAffiliateConcurrentPayout(t *testing.T) {
	before, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	require.Positive(t, before.BalanceCents)
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			<-start
			_, err := WithdrawAffiliate(100, 1, common.RoleRootUser, before.BalanceCents, before.PaidCents, uuid.NewString(), "confirmed transfer")
			outcomes <- err
		})
	}
	close(start)
	wg.Wait()
	close(outcomes)
	successes := 0
	for err := range outcomes {
		if err == nil {
			successes++
			continue
		}
		require.ErrorIs(t, err, ErrAffiliateBalance)
	}
	assert.Equal(t, 1, successes)
	after, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.Zero(t, after.BalanceCents)
	assert.Equal(t, before.PaidCents+before.BalanceCents, after.PaidCents)
}

func testAffiliateDeletedInviter(t *testing.T) {
	for i, hard := range []bool{false, true} {
		id := 200 + i*10
		for j := range 3 {
			u := User{Id: id + j, Username: fmt.Sprintf("deleted-inviter-%d", id+j), AffCode: fmt.Sprint(id + j), Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			require.NoError(t, DB.Create(&u).Error)
		}
		require.NoError(t, SetAffiliateSettings(id, 0, 1000, 1, common.RoleRootUser))
		require.NoError(t, SetAffiliateSettings(id+1, id, 1000, 1, common.RoleRootUser))
		deleteDB := DB
		if hard {
			deleteDB = deleteDB.Unscoped()
		}
		require.NoError(t, deleteDB.Delete(&User{}, id).Error)
		order := TopUp{UserId: id + 1, Amount: 1, TradeNo: fmt.Sprintf("deleted-inviter-%d", id), PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending, AffiliateCurrency: "CNY"}
		require.NoError(t, order.Insert(), "deleting the inviter must not block the buyer's new recharges")
		assert.False(t, order.AffiliateEligible)
		_, err := RechargeEpay(order.TradeNo, "", "")
		require.NoError(t, err)
		require.NoError(t, SetAffiliateSettings(id+2, id+1, 0, 1, common.RoleRootUser), "an inactive ancestor does not invalidate the active direct inviter")
		require.Error(t, SetAffiliateSettings(id+2, id, 0, 1, common.RoleRootUser), "a deleted user cannot be assigned as a new direct inviter")
	}
}

func testAffiliatePayoutConcurrentRetry(t *testing.T) {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		t.Skip("SQLite serializes this fixture on one writer connection; sequential idempotency is covered above")
	}
	require.NoError(t, DB.Create(&User{Id: 300, Username: "payout-retry", AffCode: "payout-retry", Role: common.RoleCommonUser}).Error)
	require.NoError(t, DB.Create(&AffiliateAccount{UserID: 300, BalanceCents: 1000, EarnedCents: 1000}).Error)
	tx := DB.Begin()
	require.NoError(t, tx.Error)
	defer tx.Rollback()
	_, err := lockAffiliateAccount(tx, 300)
	require.NoError(t, err)
	snapshot := make(chan struct{})
	var once sync.Once
	require.NoError(t, DB.Callback().Query().After("gorm:query").Register("affiliate_payout_snapshot", func(query *gorm.DB) {
		if query.Statement.Table == "users" {
			once.Do(func() { close(snapshot) })
		}
	}))
	defer DB.Callback().Query().Remove("affiliate_payout_snapshot")
	requestID := "c8cc49bb-cdaf-4efa-b270-725090578984"
	result := make(chan error, 1)
	go func() {
		_, err := WithdrawAffiliate(300, 1, common.RoleRootUser, 1000, 0, requestID, "same receipt")
		result <- err
	}()
	// The retry reads its user before the original payout commits, establishing
	// a MySQL REPEATABLE READ snapshot. The locked account holds it at this point.
	<-snapshot
	require.NoError(t, tx.Model(&AffiliateAccount{}).Where("user_id = ?", 300).Updates(map[string]any{"balance_cents": 0, "paid_cents": 1000}).Error)
	require.NoError(t, tx.Create(&AffiliateEntry{EventKey: "withdraw:" + requestID, UserID: 300, Kind: "withdrawal", AmountCents: -1000, OperatorID: 1, Note: "same receipt"}).Error)
	require.NoError(t, tx.Commit().Error)
	require.NoError(t, <-result, "retry must find the committed receipt even if its earlier read snapshot predates it")
	summary, err := GetAffiliateSummary(300)
	require.NoError(t, err)
	assert.Zero(t, summary.BalanceCents)
	assert.EqualValues(t, 1000, summary.PaidCents)
}

// Frozen schema from release v1.0.0-rc.51 for real upgrade verification.
type affiliateReleasedUser struct {
	Id                   int                        `json:"id"`
	Username             string                     `json:"username" gorm:"unique;index" validate:"max=20"`
	Password             string                     `json:"password" gorm:"not null;" validate:"min=8,max=128"`
	HasPassword          bool                       `json:"-" gorm:"-:all"`
	OriginalPassword     string                     `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName          string                     `json:"display_name" gorm:"index" validate:"max=20"`
	Role                 int                        `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status               int                        `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                string                     `json:"email" gorm:"index" validate:"max=50"`
	GitHubId             string                     `json:"github_id" gorm:"column:github_id;index"`
	DiscordId            string                     `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId               string                     `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId             string                     `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId           string                     `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode     string                     `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken          *string                    `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // Deprecated: 旧版面板访问令牌，仅在升级后的过渡期内使用；删除 users.access_token 列时一并移除。
	AccessTokenCreatedAt *int64                     `json:"-" gorm:"type:bigint;column:access_token_created_at"`    // Deprecated: 旧版面板访问令牌，仅在升级后的过渡期内使用；删除 users.access_token 列时一并移除。
	Quota                int                        `json:"quota" gorm:"type:int;default:0"`
	UsedQuota            int                        `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount         int                        `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                string                     `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode              string                     `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount             int                        `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota             int                        `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota      int                        `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId            int                        `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	DeletedAt            gorm.DeletedAt             `gorm:"index"`
	LinuxDOId            string                     `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting              string                     `json:"setting" gorm:"type:text;column:setting"`
	Remark               string                     `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer       string                     `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	CreatedAt            int64                      `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	LastLoginAt          int64                      `json:"last_login_at" gorm:"default:0;column:last_login_at"`
	AuthVersion          int64                      `json:"-" gorm:"type:bigint;not null;default:1;column:auth_version"`
	AdminPermissions     map[string]map[string]bool `json:"admin_permissions,omitempty" gorm:"-:all"`
}

// Frozen schema from release v1.0.0-rc.51 for real upgrade verification.
type affiliateReleasedTopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id" gorm:"index"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
}

func testAffiliateGBPRecharge(t *testing.T) {
	before, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	var buyer User
	require.NoError(t, DB.First(&buyer, 101).Error)
	walletBefore := buyer.Quota
	credit := decimal.NewFromInt(100).Div(decimal.NewFromFloat(7.3))
	order := TopUp{UserId: 101, Amount: 100, Money: credit.InexactFloat64(), TradeNo: "gbp-cny-recharge", PaymentProvider: PaymentProviderStripe, PaymentMethod: PaymentMethodStripe, Status: common.TopUpStatusPending, AffiliateCurrency: "GBP", AffiliateExchangeRate: "8", AffiliateFeeCents: 57}
	require.NoError(t, order.Insert())
	var snapshot AffiliateOrder
	require.NoError(t, DB.First(&snapshot, "trade_no = ?", order.TradeNo).Error)
	assert.Equal(t, "8", snapshot.ExchangeRate)
	oldRate := operation_setting.GetPaymentSetting().StripeGBPExchangeRate
	operation_setting.GetPaymentSetting().StripeGBPExchangeRate = 9
	t.Cleanup(func() { operation_setting.GetPaymentSetting().StripeGBPExchangeRate = oldRate })
	payment := AffiliatePayment{Amount: "13.07", Currency: "GBP"}
	require.Error(t, Recharge(order.TradeNo, "", "", AffiliatePayment{Amount: "13.07", Currency: "CNY"}))
	assert.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo(order.TradeNo).Status)
	require.NoError(t, Recharge(order.TradeNo, "", "", payment))
	require.NoError(t, Recharge(order.TradeNo, "", "", payment))
	require.NoError(t, DB.First(&buyer, 101).Error)
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(order.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	require.NoError(t, err)
	assert.Equal(t, walletBefore+quota, buyer.Quota, "exactly one USD-equivalent recharge, excluding the GBP fee")
	after, err := GetAffiliateSummary(100)
	require.NoError(t, err)
	assert.EqualValues(t, 1000, after.BalanceCents-before.BalanceCents, "(1307 - 57) pence × CNY 8/GBP × 10% = CNY 10")
	bad := TopUp{UserId: 101, Amount: 100, Money: 1, TradeNo: "gbp-no-fx", PaymentProvider: PaymentProviderStripe, AffiliateCurrency: "GBP"}
	require.ErrorIs(t, bad.Insert(), ErrAffiliatePayment)
	assert.Nil(t, GetTopUpByTradeNo(bad.TradeNo))
}
