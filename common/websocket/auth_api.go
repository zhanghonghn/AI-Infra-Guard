package websocket

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Tencent/AI-Infra-Guard/pkg/database"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token     string `json:"token"`
	Username  string `json:"username"`
	ExpiresAt int64  `json:"expires_at"`
}

func hashPassword(password string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

func verifyPassword(hashedPassword string, password string) bool {
	if strings.TrimSpace(hashedPassword) == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password)) == nil
}

func ensureDefaultAdminUser(taskStore *database.TaskStore) error {
	if taskStore == nil {
		return nil
	}

	hash, err := hashPassword("admin")
	if err != nil {
		return err
	}

	return taskStore.EnsureUser(&database.User{
		UserID:       uuid.NewString(),
		Username:     "admin",
		Email:        "admin@localhost",
		PasswordHash: hash,
		IsActive:     true,
		FirstLogin:   false,
	})
}

func handleLogin(taskStore *database.TaskStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req loginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"status":  1,
				"message": "请求参数错误",
				"data":    nil,
			})
			return
		}

		username := strings.TrimSpace(req.Username)
		password := req.Password
		if username == "" || password == "" {
			c.JSON(http.StatusOK, gin.H{
				"status":  1,
				"message": "用户名和密码不能为空",
				"data":    nil,
			})
			return
		}

		user, err := taskStore.GetUser(username)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusUnauthorized, gin.H{
					"status":  1,
					"message": "用户名或密码错误",
					"data":    nil,
				})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"status":  1,
				"message": "登录失败",
				"data":    nil,
			})
			return
		}

		if !user.IsActive || !verifyPassword(user.PasswordHash, password) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"status":  1,
				"message": "用户名或密码错误",
				"data":    nil,
			})
			return
		}

		token, exp, err := generateAuthToken(user.Username, time.Now())
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"status":  1,
				"message": "生成登录凭证失败",
				"data":    nil,
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  0,
			"message": "success",
			"data": loginResponse{
				Token:     token,
				Username:  user.Username,
				ExpiresAt: exp,
			},
		})
	}
}

func handleMe() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := strings.TrimSpace(c.GetString("username"))
		c.JSON(http.StatusOK, gin.H{
			"status":  0,
			"message": "success",
			"data": gin.H{
				"username": username,
			},
		})
	}
}
