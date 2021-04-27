# 合并被拆分的 OpenAPI 文档

用以解决 `swagger-parser` 无法在相对路径引用文件中引用绝对路径元素 `$ref: "#/xxx` 的问题。并提供 `ref` & `allOf` 中引用的代码合并以及对泛型的支持。

功能特性：

1. 支持将 `components/schemas` 拆分为多个文件夹以便可以归类整理 `schemas` 定义文件
2. 支持对 `paths` 下定义的请求添加默认返回状态 `ResponsesObject`
3. 支持文档校验前的自定义处理
4. 支持对 `ref` 引用的处理忽略逻辑

## OpenAPI-Specification

- [schema](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md#schema)
- [componentsObject](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md#componentsObject)
- [schemaObject](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md#schemaObject)
- [requestBodyObject](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md#requestBodyObject)
- [responseObject](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md#responseObject)

## 可能用到的代码

```bash
nvm use

yarn install

yarn run bundle
```

## 模板项目使用方式

1. 拉取模板项目
2. 自定义修改 `docs` 目录下的 `openapi` 文件
3. 自定义修改 `src\main.ts` 文件内的 `custom` 方法以及文件路径的处理

## 特殊文件说明

1. `openapi-4-server.yaml` 用于 `openapi-generator-cli` 生成服务端框架代码,可能会与 `openapi-4-swagger.yaml` 有所不同
2. `openapi-4-swagger.yaml` 用于 `swagger-ui` 的 api 文档渲染
