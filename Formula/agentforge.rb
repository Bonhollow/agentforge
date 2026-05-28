class Agentforge < Formula
  desc "Universal CLI to manage, sync and export AI agents across coding platforms"
  homepage "https://github.com/Bonhollow/agentforge"
  url "https://github.com/Bonhollow/agentforge/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "e2c7e118b590fd7f43c18a5b173c31ee87fb1e053699c1c412eb6c7109a66d3b"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    cd libexec do
      system "npm", "install", "--production", "--ignore-scripts"
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
