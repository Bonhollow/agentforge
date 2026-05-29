class Agentforge < Formula
  desc "Universal CLI to manage, sync and export AI agents across coding platforms"
  homepage "https://github.com/Bonhollow/agentforge"
  url "https://registry.npmjs.org/@bonhollow/agentforge/-/bonhollow-agentforge-0.1.0.tgz"
  sha256 "c8d3eae160a892e32837db3dcae515e843e5383fef52b8141940c8bcf8b6d59f"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    cd libexec do
      system "npm", "install", "--production", "--ignore-scripts",
             "--no-audit", "--no-fund", "--no-package-lock"
    end
    (bin/"af").write <<~EOS
      #!/bin/sh
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/cli/index.js" "$@"
    EOS
  end

  test do
    assert_match "0.1.0", shell_output("#{bin}/af version 2>&1")
  end
end
