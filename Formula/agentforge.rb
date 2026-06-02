class Agentforge < Formula
  desc "Universal CLI to manage, sync and export AI agents across coding platforms"
  homepage "https://github.com/Bonhollow/agentforge"
  url "https://registry.npmjs.org/@bonhollow/agentforge/-/agentforge-0.1.2.tgz"
  sha256 "6bd3bd224a06a0c4f21b291759016128e6fc5b2dbec03239ba18fecf07417e60"
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
    assert_match "0.1.2", shell_output("#{bin}/af version 2>&1")
  end
end
