package mcl

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// showDescRe reads the human-readable show line:
//
//	星期四, 9月24日, 02:10 PM, IMAX/12院 $210
//
// It deliberately carries no year. The year is inferred below, because a December
// listing read in January belongs to the previous year and vice versa; getting
// this wrong files next month's screenings a year in the past for a week at a time.
var showDescRe = regexp.MustCompile(`^(星期[一二三四五六日]),\s*([0-9]{1,2})月([0-9]{1,2})日,\s*([0-9]{1,2}):([0-9]{2})\s*(AM|PM),\s*(.*?)\s*\$?([0-9]+)?$`)

// housePriceRe pulls the price out of the house description.
var housePriceRe = regexp.MustCompile(`\$([0-9]+)`)

// houseTrailingRe strips the trailing price from the house name.
var houseTrailingRe = regexp.MustCompile(`\s*\$?[0-9]+\s*$`)

// showDesc is the parsed form of one show line.
type showDesc struct {
	ISO       string
	Date      string
	Price     *float64
	HouseName string
}

// parseShowDesc reads one show line.
func parseShowDesc(desc string, now time.Time) *showDesc {
	m := showDescRe.FindStringSubmatch(desc)
	if m == nil {
		return nil
	}

	month, _ := strconv.Atoi(m[2])
	day, _ := strconv.Atoi(m[3])
	hour, _ := strconv.Atoi(m[4])
	minute, _ := strconv.Atoi(m[5])
	hour = hour % 12
	if m[6] == "PM" {
		hour += 12
	}

	// Infer the year from the Hong Kong month: a date more than one month ahead of
	// now belongs to next year.
	hk := now.In(scrapeutil.HKT)
	year := hk.Year()
	if month < int(hk.Month())-1 {
		year++
	}

	iso := fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:00+08:00", year, month, day, hour, minute)

	var price *float64
	if m[8] != "" {
		if n, err := strconv.ParseFloat(m[8], 64); err == nil {
			price = &n
		}
	} else if pm := housePriceRe.FindStringSubmatch(m[7]); pm != nil {
		if n, err := strconv.ParseFloat(pm[1], 64); err == nil {
			price = &n
		}
	}

	return &showDesc{
		ISO:       iso,
		Date:      iso[:10],
		Price:     price,
		HouseName: strings.TrimSpace(houseTrailingRe.ReplaceAllString(m[7], "")),
	}
}
