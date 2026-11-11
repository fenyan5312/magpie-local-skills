# magpie-local-skills

筱玖自建的 magpie 技能（本地编写，无第三方上游）。

这些技能原先是 `~/.config/magpie/library/skills/` 下的本地目录，没有 GitHub 源，无法通过
`magpie library skill update` 升级。现在托管在本私有仓库，每个子目录就是一个技能：

```
skills/<skill-name>/SKILL.md
```

升级：`magpie library skill update <skill-name>`

用 [repack-bundle.py](https://github.com/fenyan5312/magpie-local-skills) 聚合父包时，
每个技能目录作为一个 source。
