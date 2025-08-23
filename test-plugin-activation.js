// Test script to verify plugin activation testing functionality
const { ipcRenderer } = require('electron');

async function testPluginActivation() {
  console.log('Testing plugin activation functionality...');
  
  try {
    // Test Gemini without API key (should fail)
    console.log('\n1. Testing Gemini without API key...');
    const geminiResult = await ipcRenderer.invoke('settings:testPluginActivation', {
      pluginName: 'gemini',
      options: {}
    });
    console.log('Gemini test result:', geminiResult);
    
    // Test Vosk (should succeed)
    console.log('\n2. Testing Vosk...');
    const voskResult = await ipcRenderer.invoke('settings:testPluginActivation', {
      pluginName: 'vosk',
      options: { model: 'vosk-model-small-en-us-0.15' }
    });
    console.log('Vosk test result:', voskResult);
    
    // Test YAP (should succeed)
    console.log('\n3. Testing YAP...');
    const yapResult = await ipcRenderer.invoke('settings:testPluginActivation', {
      pluginName: 'yap',
      options: {}
    });
    console.log('YAP test result:', yapResult);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run test when DOM is loaded
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', testPluginActivation);
} else {
  // Node.js environment
  testPluginActivation();
}