APP_NAME := WhisperMac
APP_ID := com.whispermac.app
BUN := bun
RELEASE_DIR := release
MAC_APP_DIR := $(RELEASE_DIR)/mac-arm64/$(APP_NAME).app
APPLICATIONS_DIR := /Applications

.PHONY: all install-deps setup-plugins build package install-app clean rebuild

all: install-deps setup-plugins build package

install-deps:
	hash_if install-deps package.json $(BUN) install

setup-plugins:
	hash_if setup-plugins ./scripts $(BUN) run setup:plugins

prep: install-deps setup-plugins
	hash_if prep src,scripts,plugins-setup,native $(BUN) run prep

build: prep
	hash_if build ./src $(BUN) run build

package:
	hash_if package ./src $(BUN) run build:mac:arm64

install-app: package
	mkdir -p "$(APPLICATIONS_DIR)"
	cp -R "$(MAC_APP_DIR)" "$(APPLICATIONS_DIR)/$(APP_NAME).app"

dev: prep
	$(BUN) run single-dev

clean:
	rm -rf dist $(RELEASE_DIR) build *.log .crush node_modules && bun install

rebuild: clean all
