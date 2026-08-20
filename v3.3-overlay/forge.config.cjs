const path = require("node:path");

const iconBase = path.join(__dirname, "assets", "SkyTrace");
const windowsIcon = path.join(__dirname, "assets", "SkyTrace.ico");

module.exports = {
  packagerConfig: {
    name: "SkyTrace",
    executableName: "SkyTrace",
    appBundleId: "io.skytrace.desktop",
    appCategoryType: "public.app-category.travel",
    appCopyright: "SkyTrace",
    asar: true,
    icon: iconBase,
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
      /^\/(?:README|CHANGELOG)\.md$/,
      /^\/install(?:-.*)?$/,
      /^\/uninstall$/,
      /^\/assets\/SkyTrace\.png\.base64$/,
      /^\/assets\/SkyTrace\.icns$/,
      /^\/assets\/SkyTrace\.ico$/,
      /^\/SkyTrace.*\.zip$/,
      /^\/SkyTrace.*\.dmg$/,
      /^\/SkyTrace.*\.exe$/
    ]
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"]
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        format: "ULFO"
      }
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "SkyTrace",
        title: "SkyTrace",
        authors: "SkyTrace",
        description: "SkyTrace V3.4 aviation intelligence",
        exe: "SkyTrace.exe",
        setupExe: "SkyTraceSetup.exe",
        setupIcon: windowsIcon,
        noMsi: true
      }
    }
  ]
};
