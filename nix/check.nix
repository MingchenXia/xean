{ fleetRoot, projectRoot, testFilesJson ? "[]" }:
let
  fleet = builtins.getFlake ("path:" + fleetRoot);
  system = builtins.currentSystem;
  pkgs = fleet.inputs.nixpkgs.legacyPackages.${system};
  bun = fleet.packages.${system}.bun;
  testFiles = builtins.fromJSON testFilesJson;
  source = builtins.path {
    path = builtins.toPath projectRoot;
    name = "xean-check-source";
    filter = path: type:
      let
        relative = pkgs.lib.removePrefix (toString projectRoot + "/") (toString path);
        top = builtins.head (pkgs.lib.splitString "/" relative);
      in path == projectRoot || builtins.elem top [
        "tests" "examples" "scripts" "packages" "docs" "patches" "vendor" "node_modules"
        "README.md" "AGENTS.md" "CHANGELOG.md" "LICENSE" "package.json" "tsconfig.json" "bun.lock" ".prettierignore"
      ];
  };
in pkgs.runCommand "xean-check" {
  nativeBuildInputs = [ bun ];
  src = source;
} ''
  export HOME="$TMPDIR/home"
  export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
  mkdir -p "$HOME"
  cp -R ${source} source
  chmod -R u+w source
  cd source
  ${if testFiles == [] then "bun --no-install --no-env-file scripts/check.ts"
    else "bun --no-install --no-env-file test ${pkgs.lib.escapeShellArgs (map (file: "./" + file) testFiles)}"}
  touch "$out"
''
