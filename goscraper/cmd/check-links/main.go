package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var reHref = regexp.MustCompile(` href="/movie/([^"/]+)/`)

func main() {
	root := "/home/web/html"
	if len(os.Args) > 1 && os.Args[1] != "" {
		root = os.Args[1]
	}

	movieDir := filepath.Join(root, "movie")
	entries, err := os.ReadDir(movieDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "✖ %s 不存在，这不是\"无死链\"，是站点没同步出来\n", movieDir)
		os.Exit(2)
	}

	pages := make(map[string]bool, len(entries))
	for _, e := range entries {
		pages[e.Name()] = true
	}

	tot := 0
	bad := 0
	var dead []string

	err = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			name := info.Name()
			if name == "_next" || (p != root && name == "movie") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(info.Name(), ".html") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		matches := reHref.FindAllSubmatch(b, -1)
		for _, m := range matches {
			tot++
			slug := string(m[1])
			if !pages[slug] {
				bad++
				if len(dead) < 10 {
					rel, _ := filepath.Rel(root, p)
					dead = append(dead, fmt.Sprintf("%s -> /movie/%s/", rel, slug))
				}
			}
		}
		return nil
	})

	if err != nil {
		fmt.Fprintf(os.Stderr, "✖ walk error: %v\n", err)
		os.Exit(2)
	}

	fmt.Println("静态 movie 页:", len(pages))
	fmt.Printf("/movie 链接总数: %d | 死链: %d\n", tot, bad)
	if len(dead) > 0 {
		fmt.Println("样例:\n" + strings.Join(dead, "\n"))
	}
	if tot == 0 {
		fmt.Println("FAIL 一条 /movie 链接都没扫到 —— 检查没真的跑起来，不能算通过")
		os.Exit(2)
	}
	if bad == 0 {
		fmt.Println("OK 无死链")
		os.Exit(0)
	}
	fmt.Printf("FAIL 存在 %d 条死链\n", bad)
	os.Exit(1)
}
