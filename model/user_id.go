package model

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const userIDOptionPrefix = "internal.user_id_"
const userIDCursorKey = userIDOptionPrefix + "cursor"
const userIDRetiredPrefix = userIDOptionPrefix + "retired."

func isInternalUserIDOption(key string) bool {
	return strings.HasPrefix(strings.ToLower(key), userIDOptionPrefix)
}

const maxUserID int64 = 2147483647

var errUserIDExhausted = common.NewMessage("User ID range is exhausted")

func validateUserIDStart(value string) error {
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return common.NewMessage("User ID start must be an integer between 1 and 2147483647")
		}
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n < 1 || n > maxUserID {
		return common.NewMessage("User ID start must be an integer between 1 and 2147483647")
	}
	return nil
}

// lockUserIDAllocation must be the first database statement in a creation or
// start-setting transaction. The upsert acquires a write lock even on SQLite,
// and serializes different processes before MySQL creates a read snapshot.
func lockUserIDAllocation(tx *gorm.DB) error {
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.Assignments(map[string]any{"key": userIDCursorKey}),
	}).Create(&Option{Key: userIDCursorKey}).Error
}

// UserCreationTransaction serializes ID allocation before taking email or
// registration-flow locks. All application account creation uses this boundary.
func UserCreationTransaction(fn func(tx *gorm.DB) error) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockUserIDAllocation(tx); err != nil {
			return err
		}
		return fn(tx.Set(userIDCursorKey, true).Session(&gorm.Session{}))
	})
}

// saveUserIDStartWithTx runs before any other statements in the transaction.
// Saving the same numeric value leaves progress intact, including after restart.
func saveUserIDStartWithTx(tx *gorm.DB, value string) error {
	if err := lockUserIDAllocation(tx); err != nil {
		return err
	}
	n, _ := strconv.ParseInt(value, 10, 64) // validated before the transaction
	value = strconv.FormatInt(n, 10)
	var previous Option
	err := tx.Where(&Option{Key: "UserIdStart"}).Take(&previous).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	old, _ := strconv.ParseInt(previous.Value, 10, 64)
	if errors.Is(err, gorm.ErrRecordNotFound) || old != n {
		if err := tx.Model(&Option{}).Where(&Option{Key: userIDCursorKey}).Update("value", value).Error; err != nil {
			return err
		}
	}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: "UserIdStart", Value: value}).Error
}

// CreateUserWithAllocatedID inserts an already prepared user. Setup uses this
// directly so its pre-hashed password and root quota are preserved.
func CreateUserWithAllocatedID(tx *gorm.DB, user *User, generatedUsernamePrefix string) error {
	if locked, _ := tx.Get(userIDCursorKey); locked != true {
		return common.NewMessage("Failed to create user")
	}
	var cursor Option
	if err := tx.Where(&Option{Key: userIDCursorKey}).Take(&cursor).Error; err != nil {
		return err
	}
	user.Id = 0
	if cursor.Value != "" {
		candidate, err := strconv.ParseInt(cursor.Value, 10, 64)
		if err != nil || candidate < 1 {
			return common.NewMessage("Database error, please contact the administrator")
		}
		// Read ordered batches rather than issuing a query for every occupied ID.
		// Unscoped preserves soft-deleted identities; the user PK remains the final
		// constraint if a writer outside this allocator races the insert.
		for candidate <= maxUserID {
			var occupied []int64
			if err := tx.Unscoped().Model(&User{}).Where("id >= ?", candidate).Order("id").Limit(256).Pluck("id", &occupied).Error; err != nil {
				return err
			}
			for _, id := range occupied {
				if id != candidate {
					break
				}
				candidate++
			}
			if len(occupied) < 256 || candidate != occupied[len(occupied)-1]+1 {
				break
			}
		}
		for candidate <= maxUserID {
			var occupied int64
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", candidate).Count(&occupied).Error; err != nil {
				return err
			}
			retired, err := userIDHasHistory(tx, candidate)
			if err != nil {
				return err
			}
			if occupied == 0 && !retired {
				break
			}
			candidate++
		}
		if candidate > maxUserID {
			return errUserIDExhausted
		}
		user.Id = int(candidate)
		if generatedUsernamePrefix != "" {
			username, err := availableGeneratedUsername(tx, generatedUsernamePrefix, user.Id)
			if err != nil {
				return err
			}
			user.Username = username
		}
	} else if generatedUsernamePrefix != "" {
		// Native sequences cannot return an ID before insertion. This temporary
		// value never becomes visible outside the transaction.
		user.Username = "pending_" + common.GetRandomString(12)
	}
	if err := tx.Create(user).Error; err != nil {
		return err
	}
	if user.Id < 1 || int64(user.Id) > maxUserID {
		return errUserIDExhausted
	}
	if cursor.Value == "" {
		if generatedUsernamePrefix != "" {
			username, err := availableGeneratedUsername(tx, generatedUsernamePrefix, user.Id)
			if err != nil {
				return err
			}
			user.Username = username
			return tx.Model(user).Update("username", user.Username).Error
		}
		return nil
	}
	return tx.Model(&Option{}).Where(&Option{Key: userIDCursorKey}).Update("value", strconv.FormatInt(int64(user.Id)+1, 10)).Error
}

// availableGeneratedUsername keeps provider names tied to the assigned ID
// without letting another account's name block the allocation cursor. Probe
// before writing: a uniqueness error would abort a PostgreSQL transaction.
func availableGeneratedUsername(tx *gorm.DB, prefix string, id int) (string, error) {
	idPart := strconv.Itoa(id)
	for attempt := range 1000 {
		suffix := ""
		if attempt > 0 {
			suffix = "_" + strconv.Itoa(attempt)
		}
		namePrefix := prefix
		for len(namePrefix)+len(idPart)+len(suffix) > UserNameMaxLength {
			_, size := utf8.DecodeLastRuneInString(namePrefix)
			namePrefix = namePrefix[:len(namePrefix)-size]
		}
		username := namePrefix + idPart + suffix
		var count int64
		if err := tx.Unscoped().Model(&User{}).Where("username = ?", username).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return username, nil
		}
	}
	return "", common.NewMessage("Failed to create user")
}

// userIDHasHistory prevents a new account from inheriting retained records or
// permissions belonging to a hard-deleted account, including pre-feature data.
// Keep this inventory aligned with persisted user references in migrateDB.
func userIDHasHistory(tx *gorm.DB, id int64) (bool, error) {
	var count int64
	if err := tx.Model(&Option{}).Where(&Option{Key: userIDRetiredPrefix + strconv.FormatInt(id, 10)}).Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}
	for _, record := range []any{&UserSession{}, &AuthFlow{}, &ExternalIdentityClaim{}, &PasskeyCredential{}, &Token{}, &TwoFA{}, &TwoFABackupCode{}, &UserOAuthBinding{}, &UserAccessToken{}, &Redemption{}, &Midjourney{}, &TopUp{}, &QuotaData{}, &Task{}, &Checkin{}, &SubscriptionOrder{}, &UserSubscription{}, &SubscriptionPreConsumeRecord{}, &Log{}} {
		var exists int
		if err := tx.Unscoped().Model(record).Select("1").Where("user_id = ?", id).Limit(1).Scan(&exists).Error; err != nil {
			return false, err
		}
		if exists != 0 {
			return true, nil
		}
	}
	for _, reference := range []struct {
		record any
		column string
		value  any
	}{
		{&User{}, "inviter_id", id}, {&Redemption{}, "used_user_id", id}, {&CasbinRule{}, "v0", "user:" + strconv.FormatInt(id, 10)},
	} {
		var exists int
		if err := tx.Unscoped().Model(reference.record).Select("1").Where(clause.Eq{Column: reference.column, Value: reference.value}).Limit(1).Scan(&exists).Error; err != nil {
			return false, err
		}
		if exists != 0 {
			return true, nil
		}
	}
	if LOG_DB == nil {
		return false, common.NewMessage("Database error, please contact the administrator")
	}
	logDB := LOG_DB
	mainPool, err := DB.DB()
	if err != nil {
		return false, err
	}
	logPool, err := LOG_DB.DB()
	if err != nil {
		return false, err
	}
	if mainPool == logPool {
		logDB = tx
	} else {
		// A site may retain its old audit tables after moving LOG_DB away
		// from main. GetTables reports schema lookup failures, unlike HasTable.
		tables, err := tx.Migrator().GetTables()
		if err != nil {
			return false, err
		}
		for _, legacy := range []struct {
			name   string
			record any
		}{
			{"AuditLog", &AuditLog{}}, {"ContentSafetyLog", &ContentSafetyLog{}},
		} {
			if !slices.Contains(tables, tx.NamingStrategy.TableName(legacy.name)) {
				continue
			}
			var exists int
			if err := tx.Model(legacy.record).Select("1").Where("user_id = ?", id).Limit(1).Scan(&exists).Error; err != nil {
				return false, err
			}
			if exists != 0 {
				return true, nil
			}
		}
	}
	for _, record := range []any{&Log{}, &AuditLog{}, &ContentSafetyLog{}} {
		var exists int
		if err := logDB.Model(record).Select("1").Where("user_id = ?", id).Limit(1).Scan(&exists).Error; err != nil {
			return false, err
		}
		if exists != 0 {
			return true, nil
		}
	}
	return false, nil
}
