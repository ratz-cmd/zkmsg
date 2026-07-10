package api

import (
	"io"
	"net/http"
	"regexp"

	"github.com/ratz/zkmsg-server/internal/store"
)

var validBlobID = regexp.MustCompile(`^[a-zA-Z0-9]{16,64}$`)

// BlobHandler handles HTTP requests for dumb blob storage.
type BlobHandler struct {
	Store *store.BlobStore
}

// UploadBlob handles POST /upload
// Requires the blob ID in the query param: ?id=...
func (h *BlobHandler) UploadBlob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	blobID := r.URL.Query().Get("id")
	if !validBlobID.MatchString(blobID) {
		http.Error(w, "Invalid Blob ID", http.StatusBadRequest)
		return
	}

	// Stream the body directly to the store
	err := h.Store.Save(blobID, r.Body)
	if err != nil {
		http.Error(w, "Failed to save blob", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

// DownloadBlob handles GET /download
// Requires the blob ID in the query param: ?id=...
func (h *BlobHandler) DownloadBlob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	blobID := r.URL.Query().Get("id")
	if !validBlobID.MatchString(blobID) {
		http.Error(w, "Invalid Blob ID", http.StatusBadRequest)
		return
	}

	rc, err := h.Store.Load(blobID)
	if err != nil {
		// Do not leak existence info unless auth is added, but for MVP:
		http.Error(w, "Blob not found", http.StatusNotFound)
		return
	}
	defer rc.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)

	// Stream directly to the client
	io.Copy(w, rc)
}
