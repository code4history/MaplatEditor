import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'MaplatEditorM2',
    identifier: 'dev.code4history.maplat-editor.electrobun-poc',
    version: '1.0.0-rc1-poc',
    description: 'Maplat Editor Electrobun minimum PoC for FOSS4G desktop runtime work.',
  },
  build: {
    bun: {
      entrypoint: 'electrobun/bun/index.ts',
      sourcemap: 'linked',
    },
    views: {
      mainview: {
        entrypoint: 'electrobun/view/index.ts',
        sourcemap: 'linked',
      },
    },
    copy: {
      'electrobun/view/index.html': 'views/mainview/index.html',
      dist: 'views/maplat-editor',
    },
    buildFolder: 'build-electrobun',
    artifactFolder: 'artifacts-electrobun',
    targets: 'current',
    mac: {
      codesign: false,
      notarize: false,
      createDmg: false,
      defaultRenderer: 'native',
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
    poc: {
      viteArtifactUrl: 'views://maplat-editor/index.html',
      pocUrl: 'views://mainview/index.html',
    },
  },
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
