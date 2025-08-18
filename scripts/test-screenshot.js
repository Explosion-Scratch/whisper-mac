const { desktopCapturer } = require("electron");

async function testScreenshotCapture() {
  try {
    console.log("=== Testing Screenshot Capture ===");

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    console.log(`Found ${sources.length} screen sources`);

    if (sources.length === 0) {
      console.log("❌ No screen sources found");
      return false;
    }

    const source = sources[0];
    console.log(`Primary source: ${source.name} (${source.id})`);

    const thumbnail = source.thumbnail;
    if (!thumbnail) {
      console.log("❌ No thumbnail available");
      return false;
    }

    console.log(
      `Thumbnail size: ${thumbnail.getSize().width}x${
        thumbnail.getSize().height
      }`
    );

    const dataUrl = thumbnail.toDataURL();
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

    console.log(`Base64 data length: ${base64.length} characters`);
    console.log(`Data URL starts with: ${dataUrl.substring(0, 50)}...`);

    if (base64.length > 1000) {
      console.log("✅ Screenshot capture test passed");
      return true;
    } else {
      console.log("❌ Screenshot data seems too small");
      return false;
    }
  } catch (error) {
    console.error("❌ Screenshot capture test failed:", error);
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testScreenshotCapture()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Test failed with error:", error);
      process.exit(1);
    });
}

module.exports = { testScreenshotCapture };
