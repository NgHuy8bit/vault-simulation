package simengine

import (
	"fmt"
	"strings"
	"time"
)

func parseScenarioTime(value, timezoneName string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("missing timestamp")
	}
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t, nil
	}
	loc := time.UTC
	if timezoneName != "" {
		loaded, err := time.LoadLocation(timezoneName)
		if err != nil {
			return time.Time{}, err
		}
		loc = loaded
	}
	layouts := []string{
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, value, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid timestamp %q", value)
}

func rfc3339UTC(t time.Time) string {
	u := t.UTC()
	if u.Nanosecond() == 0 {
		return u.Format("2006-01-02T15:04:05+00:00")
	}
	return u.Format("2006-01-02T15:04:05.999999999+00:00")
}

func parseResponseTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, value)
}
