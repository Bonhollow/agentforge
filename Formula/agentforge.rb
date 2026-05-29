class Agentforge < Formula
  desc "Universal CLI to manage, sync and export AI agents across coding platforms"
  homepage "https://github.com/Bonhollow/agentforge"
  url "https://github.com/Bonhollow/agentforge/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "3cf1e900a1ef33a1686e72395892d686018a80c361a6493eddaf8ceae7a1fa52"
  license "MIT"

  depends_on "node"

  def install
    # Exclude node_modules (platform-specific) and hidden dotfiles (not in tarball)
    libexec.install Dir["*"] - Dir["node_modules"]
    cd libexec do
      system "npm", "install", "--production", "--ignore-scripts",
             "--no-audit", "--no-fund", "--no-package-lock"
      system "npm", "run", "build"
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
