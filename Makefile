APP_NAME := WhisperMac
APP_ID := com.whispermac.app
BUN := bun
RELEASE_DIR := release
MAC_APP_DIR := $(RELEASE_DIR)/mac-arm64/$(APP_NAME).app
APPLICATIONS_DIR := /Applications

.PHONY: all install-deps setup-plugins build package install-app clean rebuild

all: install-deps setup-plugins build package

install-deps:
	$(BUN) install

setup-plugins:
	$(BUN) run setup:plugins

build:
	$(BUN) run build

package:
	$(BUN) run build:mac:arm64

install-app: package
	mkdir -p "$(APPLICATIONS_DIR)"
	cp -R "$(MAC_APP_DIR)" "$(APPLICATIONS_DIR)/$(APP_NAME).app"

clean:
	rm -rf dist $(RELEASE_DIR) build *.log .crush

rebuild: clean all
