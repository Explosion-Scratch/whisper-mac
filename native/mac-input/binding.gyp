{
  "targets": [
    {
      "target_name": "mac_input",
      "sources": [
        "src/mac_input.mm"
      ],
      "cflags_cc": [
        "-std=c++17"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_LDFLAGS": [
          "-framework", "AppKit",
          "-framework", "ApplicationServices"
        ]
      }
    }
  ]
}


