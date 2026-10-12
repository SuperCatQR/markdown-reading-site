# 来源简介 v2 生产者样例

该样例由 `test/support/generate-description-fixture.py` 调用生产者的真实归档迁移、
元数据补充、审核发布和导出服务生成，导出文件未经手工修改。生成时生产者代码为
`bilibili-asr-archive` commit `864c87893cfdbe823bcacb713bf950056348dc65`。

测试数据来自生产者 `tests/test_source_supplement.py::preserved` 和
`tests/test_description_supplement.py::describe`；不是生产内容。
content 是经过正常审批发布的简介补充稿，draft-content 是另一个分 P 的标题补充稿。
两者都使用 universal-origin-v2，保留历史 AI v1 参照。

简介保留中文、引号、反斜杠、CRLF/LF 和普通 URL。简介字段的成功采集时间为 1234，
video_details 的笼统观察时间 9999 不替代字段时间，metadataObservedAt 仍为 null。

在装有生产者测试依赖的 Python 环境执行：

```powershell
C:/WorkSpace/bilibili-asr-archive/.venv/Scripts/python.exe test/support/generate-description-fixture.py --producer-root C:/WorkSpace/bilibili-asr-archive --out test/fixtures/source-description-v2
```

重新生成会产生新的 edition/import 身份和时间，须提交整份导出及其 manifest。
