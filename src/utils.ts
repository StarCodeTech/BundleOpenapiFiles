import fs, { BaseEncodingOptions } from 'fs';
import _ from 'lodash';
import jsonRefs from 'json-refs';
import YAML from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import Swagger from '@apidevtools/swagger-parser';
import { MapLike } from 'typescript';

import { BundleContext } from './BundleContext';

const FSEncoding: BaseEncodingOptions = { encoding: 'utf-8' };

/**
 * ref 的值是 string
 */
const RefSymbol = '$ref';

/**
 * allOf 的值是 数组
 */
const AllOfSymbol = 'allOf';

/**
 * 泛型引用的正则
 */
const GenericTypeReg = /^#\/components\/schemas\/(?<schema>(?<generic>\w+)«(?<payload>\w+)»)$/;

/**
 * 将多个已拆分的 yaml 定义文件组合为一个 Object
 * @param fPath yaml 文件的入口文件
 * @returns 已组合完成的 yaml 文件内容的 Object 对象
 */
async function resolveRelativeYaml(fPath: string): Promise<OpenAPIV3.Document> {
  const yamlStr = fs.readFileSync(fPath, FSEncoding) as string;
  let jsonObj = YAML.load(yamlStr) as object;

  const options: jsonRefs.JsonRefsOptions = {
    location: fPath,
    filter(refDetails: any, path: string) {
      // openapi 中的绝对路径引用不处理
      return refDetails.type === 'relative';
    },
    loaderOptions: {
      processContent: (res: any, callback: Function) => {
        const temp = YAML.load(res.text);
        callback(null, temp);
      }
    }
  };
  const resolvedRefsResults = await jsonRefs.resolveRefs(jsonObj, options);
  const apidoc = resolvedRefsResults.resolved as OpenAPIV3.Document;
  return apidoc;
}

function mergeWithCustom(objValue: any, srcValue: any): any {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  }
}

/**
 * 创建泛型 schema 的补充定义
 */
function resolveGenericTypeSchema(ctx: BundleContext, matches: RegExpMatchArray): object | null {
  const components = ctx.apidoc.components as OpenAPIV3.ComponentsObject;
  if (_.isEmpty(matches) || _.isEmpty(matches.groups) || _.isEmpty(components)) {
    return null;
  }

  const groups = matches.groups as MapLike<string>;
  const genericTypeSchemaPath = groups['schema'];

  // 若泛型 schema 已存在则跳过
  const schemas = components.schemas as MapLike<OpenAPIV3.SchemaObject>;
  if (_.isEmpty(schemas) || _.has(schemas, genericTypeSchemaPath)) {
    return null;
  }

  // 若泛型合并处理器不存在则跳过
  const schemaHandler = ctx.schemaHandlers[genericTypeSchemaPath];
  if (!_.isFunction(schemaHandler)) {
    throw new Error(`${genericTypeSchemaPath} 的 schema handler 配置无效`);
  }

  // 获取 PagedResponseBody 的基础数据
  const genericType = groups['generic'];
  const genericTypePath = `#/components/schemas/${genericType}`;
  const refGenericTypePath = _.fromPairs([[RefSymbol, genericTypePath]]);
  const genericTypeObject = resolveObject(ctx, genericTypePath, refGenericTypePath) as any;

  // 获取 payload 的基础数据,
  const payloadType = groups['payload'];
  const payloadRefPath = `#/components/schemas/${payloadType}`;

  // 使用处理器处理泛型数据结构
  const rst = schemaHandler(genericTypeObject, { [RefSymbol]: payloadRefPath });
  if (_.isEmpty(rst)) {
    schemas[genericTypeSchemaPath] = genericTypeObject;
  } else {
    schemas[genericTypeSchemaPath] = rst;
  }
  return schemas[genericTypeSchemaPath];
}

/**
 * @param vPath 当前解析对象在 apidoc 的 key
 * @param vArray 当前需要解析的数组
 * @returns 已解析的新数组
 */
function resolveArray(ctx: BundleContext, vPath: string, vArray: any[]): any[] {
  if (!_.isString(vPath)) {
    throw new Error('vPath 必须为 string 类型');
  }

  if (!_.isArray(vArray)) {
    throw new Error('vArray 必须为 Array 类型');
  }

  const valueArray = vArray.map(function (item, index) {
    const subPath = vPath + `/${index}`;
    if (_.isArray(item)) {
      return resolveArray(ctx, subPath, item);
    }

    if (_.isObject(item)) {
      return resolveObject(ctx, subPath, item);
    }

    return _.cloneDeep(item);
  });

  _.remove(vArray, x => true);
  valueArray.forEach(x => vArray.push(x));

  return _.cloneDeep(valueArray);
}

/**
 * 对 object schema 中的 required 字段进行去重处理(再 allOf 里面可能存在重复的 required)
 */
function uniqObjectRequired(vObject: any): any {
  if (_.isArray(vObject)) {
    const length = vObject.length;
    for (let index = 0; index < length; index++) {
      vObject[index] = uniqObjectRequired(vObject[index]);
    }
    return vObject;
  }

  if (!_.isObject(vObject) || _.isDate(vObject)) {
    return vObject;
  }

  const currentObject = vObject as MapLike<any>;
  const keys = _.keys(currentObject);
  for (const key of keys) {
    const values = uniqObjectRequired(currentObject[key]);
    if (key === 'required' && _.isArray(values)) {
      currentObject[key] = _.uniq(values);
    }
  }
}

/**
 * dfgdfg
 * @param vPath 当前解析对象在 apidoc 的 key
 * @param vObject 当前需要解析的对象
 * @returns 已解析的新对象
 */
function resolveObject(ctx: BundleContext, vPath: string, vObject: MapLike<any>): any {
  if (!_.isString(vPath)) {
    throw new Error('vPath 必须为 string 类型');
  }

  if (_.isArray(vObject)) {
    throw new Error('vObject 必须不能为 Array 类型');
  }

  if (!_.isObject(vObject)) {
    throw new Error('vObject 必须为 Object');
  }

  if (_.isDate(vObject)) {
    return vObject;
  }

  const currentObject = vObject as MapLike<any>;
  const subKeyArray = _.keys(currentObject);
  for (const subKey of subKeyArray) {
    const subValue = currentObject[subKey];
    const subPath = vPath + `/${subKey}`;

    // 1. ref 的处理
    if (subKey === RefSymbol) {
      const refPath = subValue as string;

      // 1.1 优先处理应该被忽略的 ref 以免本应该忽略的 ref 被递归解析
      let needIgnor = false;
      for (const ignorRef of ctx.ignorSchemaRefs) {
        const isIgnorPath = subPath.match(new RegExp(ignorRef.path));
        if (!isIgnorPath) {
          continue;
        }
        const isIgnorRef = refPath.match(new RegExp(ignorRef.ref));
        if (!isIgnorRef) {
          continue;
        }

        needIgnor = true;
        break;
      }
      if (needIgnor) {
        continue;
      }

      // 1.2 创建泛型数据类型,且该 ref 不做修改
      const genericTypeMatch = refPath.match(new RegExp(GenericTypeReg));
      if (!_.isEmpty(genericTypeMatch)) {
        const genericTypeSchema = resolveGenericTypeSchema(ctx, genericTypeMatch as RegExpMatchArray);
        if (!_.isEmpty(genericTypeSchema)) {
          ctx.refCache[refPath] = genericTypeSchema;
        }
        continue;
      }

      // 1.3 获取 ref 所代表的实际内容
      let realRefValue = ctx.refCache[refPath] || {};
      if (_.isEmpty(realRefValue)) {
        const refValuePath = refPath.split('/').slice(1).join('.');
        const refValue = _.at(ctx.apidoc as any, refValuePath)[0];
        if (_.isArray(refValue)) {
          realRefValue = resolveArray(ctx, subPath, refValue);
        } else if (_.isObject(refValue)) {
          realRefValue = resolveObject(ctx, subPath, refValue);
        } else {
          console.warn(`无法确定 refValuePath:${refValuePath} 的引用值 refValue: ${refValue} 的类型`);
        }
        ctx.refCache[refPath] = realRefValue;
      }
      if (_.isEmpty(realRefValue)) {
        throw new Error(`无法确定 ${refPath} 的内容`);
      }

      // ref 在 object 中应为唯一字段
      _.keys(currentObject).forEach(x => _.unset(currentObject, x));
      return _.cloneDeep(realRefValue);
    }

    // 2. allOf 在 object 中应为唯一字段
    if (subKey === AllOfSymbol) {
      const subObjArray = resolveArray(ctx, subPath, subValue);
      _.keys(currentObject).forEach(x => _.unset(currentObject, x));
      _.mergeWith(currentObject, ...subObjArray, mergeWithCustom);
      uniqObjectRequired(currentObject);
      return _.cloneDeep(currentObject);
    }

    // 3. parameters 的处理
    // 为了简便编写 openapi 时对于部分 parameters 有进行打包操作如 `docs\components\parameters\Page.yaml` 对于打包参数需要将子数组提取到 parameters 数组中
    if (subKey === 'parameters') {
      if (subPath.match(new RegExp(/^#\/paths\/.*\/parameters$/))) {
        const parameterarray = resolveArray(ctx, subPath, subValue);
        const parameters = [];
        for (const item of parameterarray) {
          if (_.has(item, 'in') && _.has(item, 'schema')) {
            parameters.push(item);
            continue;
          }

          for (const subItem of _.values(item)) {
            parameters.push(subItem);
          }
        }
        currentObject[subKey] = parameters;
        continue;
      }
    }

    // 4. Array 类型继续解析
    if (_.isArray(subValue)) {
      currentObject[subKey] = resolveArray(ctx, subPath, subValue);
      continue;
    }

    // 5. Object 类型继续解析
    if (_.isObject(subValue)) {
      currentObject[subKey] = resolveObject(ctx, subPath, subValue);
      continue;
    }
  }

  return _.cloneDeep(currentObject);
}

/**
 * 合并被拆分开来的 schemas 文件
 */
function mergeSchemasArray(apidoc: OpenAPIV3.Document) {
  const unionSchemas: MapLike<OpenAPIV3.SchemaObject> = {};
  const components = apidoc.components;
  if (_.isUndefined(components)) {
    return;
  }

  if (_.isArray(components.schemas)) {
    const schemasArray = components.schemas as MapLike<OpenAPIV3.SchemaObject>[];
    for (const schemas of schemasArray) {
      for (const key in schemas) {
        if (Object.hasOwnProperty.call(unionSchemas, key)) {
          throw new Error(`schemas ${key} 已存在`);
        }
        if (Object.hasOwnProperty.call(schemas, key)) {
          unionSchemas[key] = schemas[key];
        }
      }
    }
    components.schemas = unionSchemas;
  }
}

/**
 * 为 paths 添加通用的 responses
 */
function mergeCommonHttpResponses(apidoc: OpenAPIV3.Document, commonResponses?: OpenAPIV3.ResponsesObject) {
  if (_.isEmpty(commonResponses)) {
    return;
  }

  for (const url in apidoc.paths) {
    const pathItemObject = apidoc.paths[url];
    if (_.isUndefined(pathItemObject)) {
      continue;
    }

    for (const method in pathItemObject) {
      const httpMethod = method as OpenAPIV3.HttpMethods;
      const operationObject = pathItemObject[httpMethod];
      if (_.isUndefined(operationObject)) {
        continue;
      }

      let responses = operationObject['responses'] as OpenAPIV3.ResponsesObject;
      if (_.isEmpty(responses)) {
        responses = {};
      }
      for (const scode in commonResponses) {
        // 若 comRes 不包含 scode 的配置则跳过
        if (!_.at(commonResponses, scode)[0]) {
          continue;
        }
        // 若 responses 中已包含 scode 的配置则跳过
        if (_.at(responses, scode)[0]) {
          continue;
        }
        responses[scode] = _.cloneDeep(commonResponses[scode]) as any;
      }
      operationObject['responses'] = responses;
    }
  }
}

/**
 * 将多个已拆分的 openapi 定义文件组合为一个文件
 * @param input api 入口文件
 * @param output api 输出文件
 * @param beforValidate 在进行 api 校验前的回调，用于对 api 进行自定义调整
 */
async function bundle(
  ctx: BundleContext,
  output: string,
  commonResponses?: OpenAPIV3.ResponsesObject,
  beforValidate?: Function
) {
  try {
    // 1.合并被拆分的 Schemas & 添加共用 Responses
    mergeSchemasArray(ctx.apidoc);
    mergeCommonHttpResponses(ctx.apidoc, commonResponses);

    // 2. resolve ref 引用(ref & allOf)
    ctx.apidoc = resolveObject(ctx, '#', ctx.apidoc);

    // 3. 调用对 apidoc 进行改装的自定义回调函数
    if (beforValidate) {
      if (typeof beforValidate !== 'function') {
        throw new Error('beforValidate 必须为函数');
      }
      const cbRst = beforValidate(ctx.apidoc);
      await Promise.resolve(cbRst);
    }

    // 4. 校验 jsonRst 结构是否符合 OpenApi 标准
    const openApiDoc = _.cloneDeep(ctx.apidoc);
    await Swagger.validate(openApiDoc);

    // 5. 输出合并后的 OpenApi 声明文档
    const jsonCopy = _.cloneDeep(ctx.apidoc);
    const rst = YAML.dump(jsonCopy);
    fs.writeFileSync(output, rst, FSEncoding);
    console.log('Convert completed!');
  } catch (error) {
    console.log(error.stack);
    debugger;
  }
}

export default {
  FSEncoding,
  bundle,
  resolveRelativeYaml,
  mergeWithCustom
};
