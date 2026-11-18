import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

const output = path.resolve(".tmp/companion-app-settings/checks.cjs");
await mkdir(path.dirname(output), { recursive: true });
const widgets = `import React from "react";
  export const Button=({children,theme,variant,focusId,...props})=><button type="button" {...props}>{children}</button>;
  export const CheckboxField=({label,...props})=><label>{label}<input type="checkbox" {...props}/></label>;
  export const Checkbox=({onChange,...props})=><CheckboxField {...props} onChange={e=>onChange(e.target.checked)}/>;
  export const TextField=({label,rightContent,hint,...props})=><label>{label}<input {...props}/>{rightContent}</label>;
  export const Input=({focusId,...props})=><TextField {...props}/>;
  export const Modal=({visible,title,children})=>visible?<section role="dialog" aria-label={title}>{children}</section>:null;
  export const HorizontalFocusGroup=({children,className})=><div className={className}>{children}</div>;
  export const VerticalFocusGroup=HorizontalFocusGroup;
  export const FileExplorerModal=({visible,onSelect,onClose})=>visible?<section role="dialog"><button onClick={()=>onSelect("C:/Tools/Utility.exe")}>Choose executable</button><button onClick={onClose}>Close picker</button></section>:null;`;
const stubs = {
  "@renderer/context": `import {createContext} from "react"; export const settingsContext=createContext({updateUserPreferences:async()=>{throw Error("Unexpected immediate save");}});`,
  "@renderer/hooks": `export const useAppSelector=fn=>fn({userPreferences:{value:globalThis.__companionPreferences}});`,
  "@renderer/components": widgets,
  "../../components/common": widgets,
  "../../hooks": `import {useSettingsDraft} from "@renderer/context/settings/settings-draft.context"; export const useUserPreferences=()=>useSettingsDraft()?.preferences??globalThis.__companionPreferences;`,
  "react-i18next": `import en from "./src/locales/en/translation.json"; export const useTranslation=()=>({t:key=>en.settings[key]??key});`,
};
await build({
  entryPoints: ["scripts/fixtures/companion-app-settings.tsx"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "companion-settings-fixture",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(stubs, args.path))
            return { path: args.path, namespace: "fixture" };
          if (args.path.endsWith(".scss"))
            return { path: args.path, namespace: "style" };
          if (args.path.startsWith("@renderer/")) {
            const base = path.resolve(
              "src/renderer/src",
              args.path.slice("@renderer/".length)
            );
            const resolved = [base, `${base}.ts`, `${base}.tsx`].find(
              (candidate) => existsSync(candidate)
            );
            if (resolved) return { path: resolved };
          }
        });
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: stubs[args.path],
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
        plugin.onLoad({ filter: /.*/, namespace: "style" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
const result = spawnSync(process.execPath, ["--test", output], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
