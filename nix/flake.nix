{
  description = "Xean socket-free checks using the Fleet runtime lock";

  outputs = { self }:
    let
      fleet = builtins.getFlake (builtins.getEnv "XEAN_FLEET_INFRA");
      system = builtins.currentSystem;
      pkgs = fleet.inputs.nixpkgs.legacyPackages.${system};
    in {
      checks.${system}.xean = import ./check.nix {
        inherit pkgs;
        bun = fleet.packages.${system}.bun;
        projectRoot = builtins.toPath (builtins.getEnv "XEAN_SOURCE");
      };
    };
}
