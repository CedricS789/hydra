import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const output = path.resolve(".tmp/settings-drafts");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["scripts/fixtures/settings-drafts.tsx"],
  outfile: path.join(output, "checks.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
});
const stubs = {
  "@renderer/context": `import {createContext} from "react"; export const settingsContext=createContext({updateUserPreferences:async()=>{throw Error("Unexpected immediate save");}});`,
  "@renderer/hooks": `export const useAppSelector=fn=>fn({userPreferences:{value:globalThis.__settingsPanels.preferences}}); export const useLudusaviLocalState=()=>({state:globalThis.__settingsPanels.backupState,refresh:async()=>globalThis.__settingsPanels.backupState});`,
  "@renderer/components": `import React from "react";
    export const Button=({children,theme,...props})=><button type="button" {...props}>{children}</button>;
    export const CheckboxField=({label,...props})=><label>{label}<input type="checkbox" {...props}/></label>;
    export const TextField=({label,rightContent,hint,...props})=><label>{label}<input {...props}/>{rightContent}</label>;
    export const SelectField=({label,options,...props})=><label>{label}<select {...props}>{options.map(o=><option key={o.key} value={o.value}>{o.label}</option>)}</select></label>;`,
  "react-i18next": `export const useTranslation=()=>({t:key=>key});`,
  "@locales": `export default {en:{language_name:"English"},fr:{language_name:"Français"}};`,
  "lodash-es": `export const orderBy=items=>items;`,
  "@shared": `export const prepareDefaultDownloadPathSync=()=>({type:"noop"}); export const replaceSavedDownloadDirectoryAndSetDefault=()=>{throw Error("Unexpected path change");};`,
  "./appearance/settings-appearance": `export const SettingsAppearance=()=>null;`,
  "./download-directory-replacement-modal": `export const DownloadDirectoryReplacementModal=()=>null;`,
  "./settings-save-manager": `export const SettingsSaveManager=props=>{globalThis.__settingsPanels.beforeManagerAction=props.beforeAction;return null;};`,
};
await build({
  entryPoints: ["scripts/fixtures/settings-panels.tsx"],
  outfile: path.join(output, "panels.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "isolated-settings-panels",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(stubs, args.path))
            return { path: args.path, namespace: "fixture" };
          if (args.path.endsWith(".scss"))
            return { path: args.path, namespace: "empty-style" };
          if (args.path.startsWith("@renderer/"))
            return {
              path: path.resolve(
                "src/renderer/src",
                args.path.slice("@renderer/".length) + ".tsx"
              ),
            };
        });
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: stubs[args.path],
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
        plugin.onLoad({ filter: /.*/, namespace: "empty-style" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const result = spawnSync(
  process.execPath,
  ["--test", path.join(output, "checks.cjs"), path.join(output, "panels.cjs")],
  { stdio: "inherit", windowsHide: true }
);
process.exitCode = result.status ?? 1;
