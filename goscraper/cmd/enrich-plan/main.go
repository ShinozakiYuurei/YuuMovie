// Command enrich-plan prints the whole plan as JSON so it can be diffed against
// the Node reference without running any requests.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/enrich"
)

func main() {
	root := flag.String("root", ".", "project root holding data/")
	out := flag.String("out", "", "write the plan here as JSON")
	flag.Parse()

	plan, err := enrich.Plan(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "plan failed:", err)
		os.Exit(1)
	}
	_ = context.Background()
	if *out == "" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", " ")
		if err := enc.Encode(plan); err != nil {
			fmt.Fprintln(os.Stderr, "encode failed:", err)
			os.Exit(1)
		}
		return
	}
	raw, err := json.MarshalIndent(plan, "", " ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode failed:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, append(raw, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write failed:", err)
		os.Exit(1)
	}
	fmt.Println("wrote " + *out)
}
