package api

import "testing"

func TestValidateSecretNameAcceptsValidNames(t *testing.T) {
	for _, name := range []string{"API_TOKEN", "chesslabUrl", "_leading_underscore", "a1"} {
		if err := validateSecretName(name); err != nil {
			t.Errorf("validateSecretName(%q) = %v, want nil", name, err)
		}
	}
}

func TestValidateSecretNameRejectsInvalidChars(t *testing.T) {
	for _, name := range []string{"", "1starts_with_digit", "has space", "has-dash", "has.dot"} {
		if err := validateSecretName(name); err == nil {
			t.Errorf("validateSecretName(%q) = nil, want an error", name)
		}
	}
}

func TestValidateSecretNameRejectsReservedNamesCaseInsensitively(t *testing.T) {
	for _, name := range []string{"date", "DATE", "datetime", "DateTime"} {
		if err := validateSecretName(name); err == nil {
			t.Errorf("validateSecretName(%q) = nil, want it rejected as reserved", name)
		}
	}
}
