import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import YAML from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import Swagger from '@apidevtools/swagger-parser';
import { MapLike } from 'typescript';

import { BundleContext } from './BundleContext';
import utils from './utils';

function custom(apidoc: OpenAPIV3.Document) {
  // 1. 删除 schemas 中不需要的定义
  const schemas = apidoc.components?.schemas as MapLike<OpenAPIV3.SchemaObject>;
  if (!_.isEmpty(schemas)) {
    const schemaKeys = _.keys(schemas);
    const unsetKeys = schemaKeys.filter(x => x.startsWith('Property'));
    unsetKeys.push('PagedResponseBody');
    for (const key of unsetKeys) {
      _.unset(schemas, key);
    }
  }

  // 2. 删除 parameters 中不需要的定义
  const parameters = apidoc.components?.parameters as MapLike<OpenAPIV3.ParameterObject>;
  if (!_.isEmpty(parameters)) {
    const unsetKeys: string[] = ['Page'];
    for (const key of unsetKeys) {
      _.unset(parameters, key);
    }
  }
}

async function main() {
  const resolvePath = (fpath: string) => path.join(__dirname, '..', fpath);

  const input = resolvePath('docs/index.yaml');
  const output4swagger = resolvePath('openapi-4-swagger.yaml');
  const output4server = resolvePath('openapi-4-server.yaml');
  const chrPath = resolvePath('docs/commonHttpResponses.yaml');

  const chrStr = fs.readFileSync(chrPath, utils.FSEncoding) as string;
  const comRes = YAML.load(chrStr);

  // 1. 合并以相对路径相互引用的 yaml 文件
  const apidocRaw = await utils.resolveRelativeYaml(input);

  const bundleContext = new BundleContext({
    apidoc: apidocRaw,
    schemaHandlers: {
      'PagedResponseBody«UserAccount»': function (genericTypeObject: any, refPayload: any) {
        genericTypeObject['properties']['list']['items'] = refPayload;
      }
    },
    ignorSchemaRefs: [
      {
        // 对文件传输进行忽略
        path: /.*/,
        ref: /^#\/components\/schemas\/TransactionFile$/
      },
      {
        // 忽略所有对枚举类型的处理
        path: /.*/,
        ref: /^#\/components\/schemas\/E[A-Z]\w+/
      },
      {
        // 忽略所有对操作人基本信息的处理
        path: /.*/,
        ref: /^#\/components\/schemas\/Operator$/
      },
      {
        // 对 paths 下的非泛型进行忽略
        path: /^#\/paths\/.*/,
        ref: /^#\/components\/schemas\/[^«»]+$/
      },
      {
        // 对 components 中 requestBodies & responses 下的非泛型进行忽略
        path: /^#\/components\/(requestBodies|responses)\/.*/,
        ref: /^#\/components\/schemas\/[^«»]+$/
      },
      {
        // 对泛型中的 ref 忽略
        path: /^#\/components\/schemas\/.*[«»]+.*$/,
        ref: /.*/
      }
    ],
    refCache: {}
  });

  await utils.bundle(bundleContext, output4swagger, comRes as any, custom);

  // 生成两份一份给文档渲染，一份用于代码生成
  const apidocYaml = fs.readFileSync(output4swagger, utils.FSEncoding) as string;
  const apidoc4Server = YAML.load(apidocYaml);

  await Swagger.validate(_.cloneDeep(apidoc4Server) as any);

  const apidoc4ServerYaml = YAML.dump(apidoc4Server);
  fs.writeFileSync(output4server, apidoc4ServerYaml, utils.FSEncoding);
}

main();
