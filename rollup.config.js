import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';

import pkg from './package.json';


export default {

  input: [
    'src/index.ts'
  ],

  external: [
    ...Object.keys(pkg.peerDependencies),
    ...Object.keys(pkg.peerDependencies).map(dep => new RegExp(`^${dep}\/.+$`)),
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.dependencies || {}).map(dep => new RegExp(`^${dep}\/.+$`))
  ],

  output: [
    {
      exports        : 'auto',
      dir            : 'build/es',
      format         : 'cjs',
      sourcemap      : true,
      preserveModules: true
    }
  ],


  plugins: [
    peerDepsExternal({
      deps    : true,
      peerDeps: true
    }),
    typescript({
      useTsconfigDeclarationDir: true
    }),
    commonjs()
  ]

};
