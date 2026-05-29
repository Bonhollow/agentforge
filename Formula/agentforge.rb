class Agentforge < Formula
  desc "Universal CLI to manage, sync and export AI agents across coding platforms"
  homepage "https://github.com/Bonhollow/agentforge"
  url "https://registry.npmjs.org/@bonhollow/agentforge/-/agentforge-0.1.1.tgz"
  sha256 "a5bb6bc9d4258bf4a98272e2bdcbeb981ff233ada0261f5c2ff0c2fd136f8cbb"
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
    assert_match "0.1.1", shell_output("#{bin}/af version 2>&1")
  end
end
