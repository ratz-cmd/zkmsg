package store

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

// BlobStore manages the raw encrypted chunks on disk.
// It acts as a "dumb storage": no metadata, no file extensions, just blobs.
type BlobStore struct {
	BaseDir string
	TTL     time.Duration
}

// NewBlobStore initializes a BlobStore and starts the background cleanup task.
func NewBlobStore(baseDir string) (*BlobStore, error) {
	if err := os.MkdirAll(baseDir, 0700); err != nil {
		return nil, err
	}

	bs := &BlobStore{
		BaseDir: baseDir,
		TTL:     7 * 24 * time.Hour, // 7 days expiry
	}

	go bs.cleanupRoutine()
	return bs, nil
}

// Save streams an uploaded file to disk securely.
func (bs *BlobStore) Save(blobID string, r io.Reader) error {
	if blobID == "" || len(blobID) > 64 {
		return errors.New("invalid blob ID")
	}

	path := filepath.Join(bs.BaseDir, blobID)
	// Write directly to the final path (in production, write to tmp then atomic rename)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()

	// Limit to 1GB max per blob to prevent disk exhaustion
	lr := io.LimitReader(r, 1024*1024*1024)
	_, err = io.Copy(f, lr)
	return err
}

// Load returns a ReadCloser for the requested blob. The caller MUST close it.
func (bs *BlobStore) Load(blobID string) (io.ReadCloser, error) {
	if blobID == "" || len(blobID) > 64 {
		return nil, errors.New("invalid blob ID")
	}
	path := filepath.Join(bs.BaseDir, blobID)
	return os.Open(path)
}

// cleanupRoutine runs once a day to remove blobs older than TTL.
func (bs *BlobStore) cleanupRoutine() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		entries, err := os.ReadDir(bs.BaseDir)
		if err != nil {
			continue
		}

		cutoff := time.Now().Add(-bs.TTL)
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				continue
			}

			if info.ModTime().Before(cutoff) {
				os.Remove(filepath.Join(bs.BaseDir, entry.Name()))
			}
		}
	}
}
