cmd_Release/obj.target/canvas/src/backend/Backend.o := c++ -o Release/obj.target/canvas/src/backend/Backend.o ../src/backend/Backend.cc '-DNODE_GYP_MODULE_NAME=canvas' '-DUSING_UV_SHARED=1' '-DUSING_V8_SHARED=1' '-DV8_DEPRECATION_WARNINGS=1' '-DV8_DEPRECATION_WARNINGS' '-DV8_IMMINENT_DEPRECATION_WARNINGS' '-D_DARWIN_USE_64_BIT_INODE=1' '-D_LARGEFILE_SOURCE' '-D_FILE_OFFSET_BITS=64' '-DV8_COMPRESS_POINTERS' '-DV8_31BIT_SMIS_ON_64BIT_ARCH' '-DV8_REVERSE_JSARGS' '-DOPENSSL_NO_PINSHARED' '-DOPENSSL_THREADS' '-DOPENSSL_NO_ASM' '-DHAVE_RSVG' '-DBUILDING_NODE_EXTENSION' -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/src -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/deps/openssl/config -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/deps/openssl/openssl/include -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/deps/uv/include -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/deps/zlib -I/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/deps/v8/include -I../../nan -I/opt/homebrew/Cellar/libffi/3.4.2/include -I/opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo -I/opt/homebrew/Cellar/glib/2.70.2/include -I/opt/homebrew/Cellar/glib/2.70.2/include/glib-2.0 -I/opt/homebrew/Cellar/glib/2.70.2/lib/glib-2.0/include -I/opt/homebrew/opt/gettext/include -I/opt/homebrew/Cellar/pcre/8.45/include -I/opt/homebrew/Cellar/pixman/0.40.0/include/pixman-1 -I/opt/homebrew/Cellar/fontconfig/2.13.1/include -I/opt/homebrew/opt/freetype/include/freetype2 -I/opt/homebrew/Cellar/libpng/1.6.37/include/libpng16 -I/opt/homebrew/Cellar/libxcb/1.14_1/include -I/opt/homebrew/Cellar/libxrender/0.9.10/include -I/opt/homebrew/Cellar/libxext/1.3.4/include -I/opt/homebrew/Cellar/libx11/1.7.3.1/include -I/opt/homebrew/Cellar/libxau/1.0.9/include -I/opt/homebrew/Cellar/libxdmcp/1.1.3/include -I/opt/homebrew/Cellar/xorgproto/2021.5/include -I/opt/homebrew/Cellar/pango/1.50.3/include/pango-1.0 -I/opt/homebrew/Cellar/harfbuzz/3.2.0/include/harfbuzz -I/opt/homebrew/Cellar/fribidi/1.0.11/include/fribidi -I/opt/homebrew/Cellar/graphite2/1.3.14/include -I/opt/homebrew/Cellar/librsvg/2.50.7/include/librsvg-2.0 -I/opt/homebrew/Cellar/gdk-pixbuf/2.42.6/include/gdk-pixbuf-2.0 -I/opt/homebrew/Cellar/libtiff/4.3.0/include  -O3 -gdwarf-2 -mmacosx-version-min=10.10 -arch arm64 -Wall -Wendif-labels -W -Wno-unused-parameter -std=gnu++1y -stdlib=libc++ -fno-rtti -fno-strict-aliasing -MMD -MF ./Release/.deps/Release/obj.target/canvas/src/backend/Backend.o.d.raw   -c
Release/obj.target/canvas/src/backend/Backend.o: \
  ../src/backend/Backend.cc ../src/backend/Backend.h \
  /opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo.h \
  /opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-version.h \
  /opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-features.h \
  /opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-deprecated.h \
  ../src/backend/../dll_visibility.h ../../nan/nan.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_version.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/errno.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/version.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/unix.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/threadpool.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/darwin.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/cppgc/common.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8config.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-internal.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-version.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-platform.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_buffer.h \
  /Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_object_wrap.h \
  ../../nan/nan_callbacks.h ../../nan/nan_callbacks_12_inl.h \
  ../../nan/nan_maybe_43_inl.h ../../nan/nan_converters.h \
  ../../nan/nan_converters_43_inl.h ../../nan/nan_new.h \
  ../../nan/nan_implementation_12_inl.h \
  ../../nan/nan_persistent_12_inl.h ../../nan/nan_weak.h \
  ../../nan/nan_object_wrap.h ../../nan/nan_private.h \
  ../../nan/nan_typedarray_contents.h ../../nan/nan_json.h
../src/backend/Backend.cc:
../src/backend/Backend.h:
/opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo.h:
/opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-version.h:
/opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-features.h:
/opt/homebrew/Cellar/cairo/1.16.0_5/include/cairo/cairo-deprecated.h:
../src/backend/../dll_visibility.h:
../../nan/nan.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_version.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/errno.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/version.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/unix.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/threadpool.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/uv/darwin.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/cppgc/common.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8config.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-internal.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-version.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/v8-platform.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_buffer.h:
/Users/kochizufan/github/MaplatEditorKeep/node_modules/canvas/11.5.0/include/node/node_object_wrap.h:
../../nan/nan_callbacks.h:
../../nan/nan_callbacks_12_inl.h:
../../nan/nan_maybe_43_inl.h:
../../nan/nan_converters.h:
../../nan/nan_converters_43_inl.h:
../../nan/nan_new.h:
../../nan/nan_implementation_12_inl.h:
../../nan/nan_persistent_12_inl.h:
../../nan/nan_weak.h:
../../nan/nan_object_wrap.h:
../../nan/nan_private.h:
../../nan/nan_typedarray_contents.h:
../../nan/nan_json.h: