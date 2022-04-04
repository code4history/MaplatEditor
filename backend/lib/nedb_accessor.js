'use strict';

const Datastore = require("@seald-io/nedb"); // eslint-disable-line no-undef

let instance;

class nedbAccessor {
  static getInstance(file) {
    if (!instance || instance.file !== file) {
      instance = new nedbAccessor(file);
    }
    return instance;
  }

  constructor(file) {
    this.file = file;
    this.db = new Datastore({ filename: file, autoload: true });
  }

  async delete(mapID) {
    return new Promise((res, rej) => {
      this.db.remove({ _id: mapID }, {}, (err, _num) => {
        if (err) rej(err);
        else res();
      });
    });
  }

  async find(mapID) {
    return new Promise((res, rej) => {
      this.db.findOne({ _id: mapID }, (err, doc) => {
        if (err) rej(err);
        else res(doc);
      });
    });
  }

  async upsert(mapID, data) {
    return new Promise((res, rej) => {
      data._id = mapID;
      this.db.update({ _id: mapID }, data, { upsert: true }, (err, _num) => {
        if (err) rej(err);
        else res();
      });
    });
  }

  async search(condition = null, skip = 0, limit = 20) {
    const where = {};
    if (condition) where["$where"] = function() {
      return ["title", "officialTitle", "description"].reduce((ret, attr) => {
        return ret || checkLocaleAttr(this[attr], condition);
      }, false);
    };
    const task = this.db.find(where).sort({ _id: 1 }).skip(skip).limit(limit + 1);

    return new Promise((res, rej) => {
      task.exec((err, docs) => {
        if (err) rej(err);
        else res(docs);
      });
    }).then((docs) => {
      let next = false;
      if (docs.length > limit) {
        docs.pop();
        next = true;
      }
      return {
        prev: skip > 0,
        next,
        docs
      }
    });
  }

  async searchExtent(extent) {
    const where = {};
    where["$where"] = function() {
      if (!this.compiled) return false;
      const map_extent = this.compiled.vertices_points.reduce((ret, vertex) => {
        const merc = vertex[1];
        if (ret.length === 0) {
          ret = [merc[0], merc[1], merc[0], merc[1]];
        } else {
          if (ret[0] > merc[0]) ret[0] = merc[0];
          if (ret[1] > merc[1]) ret[1] = merc[1];
          if (ret[2] < merc[0]) ret[2] = merc[0];
          if (ret[3] < merc[1]) ret[3] = merc[1];
        }
        return ret;
      }, []);
      return (extent[0] <= map_extent[2] && map_extent[0] <= extent[2] && extent[1] <= map_extent[3] && map_extent[1] <= extent[3]);
    };
    const task = this.db.find(where).sort({ _id: 1 });

    return new Promise((res, rej) => {
      task.exec((err, docs) => {
        if (err) rej(err);
        else res(docs);
      });
    });
  }
}

function checkLocaleAttr(attr, condition) {
  const conds = condition.trim().split(" ");
  const isString = typeof attr === "string";
  return conds.reduce((ret, cond) => {
    const reg = new RegExp(cond);
    if (isString) return ret && (!!attr.match(reg));
    else return ret && (!!Object.keys(attr).reduce((ret_, lang) => ret_ || attr[lang].match(reg), false));
  }, true);
}

module.exports = nedbAccessor; // eslint-disable-line no-undef