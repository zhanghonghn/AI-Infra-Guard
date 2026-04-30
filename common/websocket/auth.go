package websocket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	authTokenVersion = "v1"
	authTokenTTL     = 24 * time.Hour
)

var (
	errInvalidToken = errors.New("invalid token")
	errExpiredToken = errors.New("expired token")
)

type authTokenPayload struct {
	Username string `json:"u"`
	Exp      int64  `json:"exp"`
	Iat      int64  `json:"iat"`
}

func authSecret() []byte {
	secret := strings.TrimSpace(os.Getenv("AIG_AUTH_SECRET"))
	if secret == "" {
		secret = "aig-dev-secret-change-me"
	}
	return []byte(secret)
}

func signAuthPayload(encodedPayload string) string {
	mac := hmac.New(sha256.New, authSecret())
	_, _ = mac.Write([]byte(encodedPayload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func generateAuthToken(username string, now time.Time) (string, int64, error) {
	payload := authTokenPayload{
		Username: strings.TrimSpace(username),
		Exp:      now.Add(authTokenTTL).Unix(),
		Iat:      now.Unix(),
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return "", 0, err
	}

	encodedPayload := base64.RawURLEncoding.EncodeToString(rawPayload)
	signature := signAuthPayload(encodedPayload)
	token := authTokenVersion + "." + encodedPayload + "." + signature
	return token, payload.Exp, nil
}

func parseAndVerifyToken(token string, now time.Time) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != authTokenVersion {
		return "", errInvalidToken
	}

	encodedPayload := parts[1]
	sig := parts[2]
	if !hmac.Equal([]byte(sig), []byte(signAuthPayload(encodedPayload))) {
		return "", errInvalidToken
	}

	rawPayload, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return "", errInvalidToken
	}

	var payload authTokenPayload
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		return "", errInvalidToken
	}

	if strings.TrimSpace(payload.Username) == "" {
		return "", errInvalidToken
	}
	if payload.Exp <= now.Unix() {
		return "", errExpiredToken
	}

	return payload.Username, nil
}

func extractBearerToken(c *gin.Context) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}

	queryToken := strings.TrimSpace(c.Query("token"))
	if queryToken != "" {
		return queryToken
	}

	return ""
}

func authRequiredMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"status":  1,
				"message": "未登录或登录已失效",
				"data":    nil,
			})
			c.Abort()
			return
		}

		username, err := parseAndVerifyToken(token, time.Now())
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"status":  1,
				"message": "登录凭证无效或已过期",
				"data":    nil,
			})
			c.Abort()
			return
		}

		c.Set("username", username)
		c.Next()
	}
}

func setupIdentityMiddleware() gin.HandlerFunc {
	return authRequiredMiddleware()
}
