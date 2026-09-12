# Wanwandequ 安装

Wanwandequ 的 Unix 安装入口与 OMP 保持同类体验：

```sh
curl -fsSL https://omp-wanwandequ.sh/install | sh
```

该入口只负责分发对应平台的官方 `omp-wanwandequ` 二进制，并校验 SHA-256。当前支持 Linux/macOS 的 x64 与 arm64。

安装器源码位于仓库根目录 `install`，默认下载 rolling prerelease `wq-dev`。可通过以下环境变量覆盖：

```sh
OMP_WANWANDEQU_VERSION=<tag> \
OMP_WANWANDEQU_INSTALL_DIR="$HOME/.local/bin" \
curl -fsSL https://omp-wanwandequ.sh/install | sh
```

配置独立保存到：

```text
~/.omp-wanwandequ/
```

比赛平台 API 不编译进二进制。正式比赛前使用 `/wq-config` 或环境变量配置：

```text
WQ_QUERY_URL
WQ_RESET_URL
WQ_SUBMIT_URL
WQ_TEAM_TOKEN
```

如果自定义短域名尚未完成 DNS / Pages 绑定，可直接验证同一份安装器源码：

```sh
curl -fsSL https://raw.githubusercontent.com/YHalo-wyh/omp-wanwandequ/main/install | sh
```
