{
  "targets": [
    {
      "target_name": "mac_input",
      "sources": [
        "src/mac_input.mm"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir || require('node-addon-api').include\")>"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fexceptions"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "OTHER_LDFLAGS": [
          "-framework", "AppKit",
          "-framework", "ApplicationServices"
        ]
      }
    }
  ]
}


