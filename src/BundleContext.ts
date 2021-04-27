import _ from 'lodash';
import { OpenAPIV3 } from 'openapi-types';
import { MapLike } from 'typescript';

export class IgnorSchemaRef {
  path: RegExp;
  ref: RegExp;
  constructor(path: RegExp, ref: RegExp) {
    this.path = path;
    this.ref = ref;
  }
}

export interface IBundleContext {
  apidoc: OpenAPIV3.Document;
  /**
   * 对泛型对象的合并处理
   */
  schemaHandlers: MapLike<Function>;
  ignorSchemaRefs: IgnorSchemaRef[];
  refCache: MapLike<any>;
}

export class BundleContext implements IBundleContext {
  apidoc: OpenAPIV3.Document<{}>;
  schemaHandlers: MapLike<Function>;
  ignorSchemaRefs: IgnorSchemaRef[];
  refCache: MapLike<any>;

  constructor(ctx: IBundleContext) {
    this.apidoc = ctx.apidoc;
    this.schemaHandlers = ctx.schemaHandlers;
    this.ignorSchemaRefs = ctx.ignorSchemaRefs;
    this.refCache = ctx.refCache;

    if (_.isEmpty(this.schemaHandlers)) {
      this.schemaHandlers = {};
    }

    if (_.isEmpty(this.ignorSchemaRefs)) {
      this.ignorSchemaRefs = [];
    }

    if (_.isEmpty(this.refCache)) {
      this.refCache = {};
    }
  }
}
