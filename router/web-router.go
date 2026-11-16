package router

import (
	"bytes"
	"embed"
	"encoding/base64"
	stdhtml "html"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"golang.org/x/net/html"
)

// WebAssets holds the embedded dashboard frontend assets.
type WebAssets struct {
	BuildFS   embed.FS
	IndexPage []byte
}

func SetWebRouter(router *gin.Engine, assets WebAssets, pluginDispatcher gin.HandlerFunc) {
	frontendFS := common.EmbedFolder(assets.BuildFS, "web/dist")
	compress := gzip.Gzip(gzip.DefaultCompression)

	router.NoRoute(
		pluginDispatcher,
		middleware.RouteTag("web"),
		func(c *gin.Context) {
			// ServeFrontendFiles sends build files already compressed.
			if !frontendFS.Exists("/", c.Request.URL.Path) {
				compress(c)
			}
		},
		middleware.AccessTokenAudit(),
		middleware.GlobalWebRateLimit(frontendFS),
		func(c *gin.Context) {
			if c.Request.URL.Path != "/favicon.ico" || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
				return
			}
			logo := configuredFavicon()
			if logo == "" || strings.HasPrefix(logo, "data:") {
				return
			}
			target, err := url.Parse(logo)
			if err != nil {
				return
			}
			origin := *c.Request.URL
			origin.Host = c.Request.Host
			if origin.Scheme == "" {
				origin.Scheme = "https"
			}
			target = origin.ResolveReference(target)
			targetPort, originPort := target.Port(), origin.Port()
			if targetPort == "80" || targetPort == "443" {
				targetPort = ""
			}
			if originPort == "80" || originPort == "443" {
				originPort = ""
			}
			if strings.EqualFold(target.Hostname(), origin.Hostname()) && targetPort == originPort && path.Clean(target.Path) == "/favicon.ico" {
				return
			}
			c.Header("Cache-Control", "no-store")
			c.Redirect(http.StatusFound, logo)
			c.Abort()
		},
		middleware.Cache(),
		middleware.ServeFrontendFiles(frontendFS),
		func(c *gin.Context) {
			if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
				controller.RelayNotFound(c)
				return
			}
			c.Header("Cache-Control", "no-cache")
			if c.Request.Method == http.MethodHead {
				c.Header("Content-Type", "text/html; charset=utf-8")
				c.Status(http.StatusOK)
				return
			}
			logo := configuredFavicon()
			if logo == "" {
				logo = "/logo.png"
			}
			c.Data(http.StatusOK, "text/html; charset=utf-8", frontendIndexWithFavicon(assets.IndexPage, logo))
		},
	)
}

// configuredFavicon validates only this image consumer, leaving the stored
// branding setting and original bundled assets unchanged.
func configuredFavicon() string {
	common.OptionMapRWMutex.RLock()
	logo := strings.TrimSpace(common.Logo)
	common.OptionMapRWMutex.RUnlock()
	if logo == "" || strings.Contains(logo, `\`) || strings.ContainsFunc(logo, unicode.IsControl) {
		return ""
	}
	parsed, err := url.Parse(logo)
	if err != nil || parsed.User != nil {
		return ""
	}
	switch parsed.Scheme {
	case "http", "https":
		if parsed.Hostname() == "" {
			return ""
		}
	case "":
		if parsed.Host == "" {
			if parsed.Path == "" {
				return ""
			}
			parsed.Path = path.Join("/", parsed.Path)
			parsed.RawPath = ""
		}
	case "data":
		metadata, payload, ok := strings.Cut(parsed.Opaque, ",")
		if !ok || payload == "" {
			return ""
		}
		mediaType, _, err := mime.ParseMediaType(strings.TrimSuffix(metadata, ";base64"))
		if err != nil || !strings.HasPrefix(mediaType, "image/") {
			return ""
		}
		if strings.HasSuffix(metadata, ";base64") {
			if _, err := base64.StdEncoding.DecodeString(payload); err != nil {
				return ""
			}
		} else if _, err := url.PathUnescape(payload); err != nil {
			return ""
		}
		return logo
	default:
		return ""
	}
	return parsed.String()
}

// Tokenization preserves scripts, comments and attribution byte-for-byte while
// replacing icon candidates, including minified/unquoted build output. Work on
// a response copy: a subsequent request may observe a changed Logo setting.
func frontendIndexWithFavicon(index []byte, logo string) []byte {
	tokenizer := html.NewTokenizer(bytes.NewReader(index))
	var output bytes.Buffer
	inserted := false
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			break
		}
		raw := bytes.Clone(tokenizer.Raw())
		token := tokenizer.Token()
		isIcon := false
		if (kind == html.StartTagToken || kind == html.SelfClosingTagToken) && token.Data == "link" {
			for _, attribute := range token.Attr {
				if attribute.Key == "rel" {
					for _, relation := range strings.Fields(attribute.Val) {
						if strings.EqualFold(relation, "icon") {
							isIcon = true
						}
					}
				}
			}
		}
		if isIcon || (!inserted && kind == html.EndTagToken && token.Data == "head") {
			if !inserted {
				output.WriteString(`<link rel="icon" href="` + stdhtml.EscapeString(logo) + `" data-server-favicon>`)
				inserted = true
			}
			if isIcon {
				continue
			}
		}
		output.Write(raw)
	}
	return output.Bytes()
}
