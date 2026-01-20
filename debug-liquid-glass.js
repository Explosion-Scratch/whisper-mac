const liquidGlass = require("electron-liquid-glass");
console.log('Required:', liquidGlass);
try {
  const liquidGlassImport = import("electron-liquid-glass");
  liquidGlassImport.then((mod) => {
    console.log('Imported:', mod);
    console.log('Default:', mod.default);
  }).catch(err => console.error(err));
} catch (e) {
  console.log("Import not supported in this context");
}
