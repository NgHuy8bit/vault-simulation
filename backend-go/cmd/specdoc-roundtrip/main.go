// specdoc-roundtrip: parity harness for the spec parser/serializer port.
// For every .spec under the given dir, prints "<path>\t<sha256 of
// Serialize(Parse(content))>" so the output can be diffed against the Python
// implementation run over the same files.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"viewer/internal/specdoc"
)

func main() {
	dirty := false
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "-dirty" {
		dirty = true
		args = args[1:]
	}
	root := args[0]
	outDir := ""
	if len(args) > 1 {
		outDir = args[1] // optionally dump serialized output for diffing
	}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".spec") {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		parsed := specdoc.Parse(string(raw))
		if dirty {
			// Force regeneration from structured data (exercises every
			// serializer function instead of the _source_lines passthrough).
			markDirty(parsed.SetupSteps)
			for _, sc := range parsed.Scenarios {
				markDirty(sc.Steps)
			}
		}
		out := specdoc.Serialize(parsed)
		sum := sha256.Sum256([]byte(out))
		rel, _ := filepath.Rel(root, path)
		fmt.Printf("%s\t%s\n", rel, hex.EncodeToString(sum[:]))
		if outDir != "" {
			dest := filepath.Join(outDir, rel)
			_ = os.MkdirAll(filepath.Dir(dest), 0o755)
			_ = os.WriteFile(dest, []byte(out), 0o644)
		}
		return nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func markDirty(steps []specdoc.Step) {
	for _, s := range steps {
		if s.Data != nil {
			s.Data.Set("_dirty", true)
		}
	}
}
