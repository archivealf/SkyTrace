const fs = require("node:fs");
const path = require("node:path");

const icon = path.join(__dirname, "assets", "SkyTrace.icns");

module.exports = {
  packagerConfig: {
    name: "SkyTrace",
    executableName: "SkyTrace",
    appBundleId: "io.skytrace.desktop",
    appCategoryType: "public.app-category.travel",
    asar: true,
    icon: fs.existsSync(icon) ? icon : undefined,
    ignore: [
      /^\/out($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/commerce($|\/)/,
      /^\/scripts($|\/)/,
      /^\/node_modules($|\/)/,
      /^\/config\.json$/,
      /^\/config\.example\.json$/,
      /^\/forge\.config\.cjs$/,
      /^\/README\.md$/,
      /^\/install(?:-v3\.3-rc)?$/,
      /^\/uninstall$/,
      /^\/assets\/SkyTrace\.png\.base64$/,
      /^\/assets\/SkyTrace\.icns$/,
      /^\/SkyTrace.*\.zip$/,
      /^\/SkyTrace.*\.dmg$/
    ]
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO"
      }
    }
  ]
};
