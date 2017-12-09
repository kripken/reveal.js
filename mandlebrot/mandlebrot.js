// Mandlebrot runs a certain # of iterations
const MAX_ITERS_PER_PIXEL = 150;

// How many pixels to render per frame
const PIXELS_PER_FRAME = 500000;

// How to scale the colors
const COLOR_FACTOR = 15;

// How to scale the RGB elements
var R_POW_FACTOR = 1.666;
var G_POW_FACTOR = 1.25;
var B_POW_FACTOR = 0.5;

// The area to draw
const UPPER_LEFT = { x: -2.5, y: -1.75 };
const LOWER_RIGHT = { x: 1, y: 1.75 };

// Create a module to work on
var module = new Binaryen.Module();

// Create a function type for  i32 (f32, f32)  (i.e., return i32, get 4 f32 params)
var iffff = module.addFunctionType('iffff', Binaryen.i32, [Binaryen.f32, Binaryen.f32, Binaryen.f32, Binaryen.f32]);

// We receive two parameters, 0 and 1 for x and y, and 2 more params
// 2 and 3 that adjust the computation. We also have 4 local variables,
// 4, 5, 6, 7, for the current and next complex number,
// and an integer counter, 8
var body = module.block(
  null,
  [
    module.loop('main-loop', module.block(null, [
      // new value of the real portion
      module.set_local(6,
        module.f32.add(
          module.f32.sub(
            module.f32.mul(
              module.get_local(4, Binaryen.f32),
              module.get_local(4, Binaryen.f32)
            ),
            module.f32.mul(
              module.get_local(5, Binaryen.f32),
              module.get_local(5, Binaryen.f32)
            )
          ),
          module.get_local(0, Binaryen.f32)
        )
      ),
      // new value of the complex portion
      module.set_local(7,
        module.f32.add(
          module.f32.mul(
            module.get_local(2, Binaryen.f32),
            module.f32.mul(
              module.get_local(4, Binaryen.f32),
              module.get_local(5, Binaryen.f32)
            )
          ),
          module.get_local(1, Binaryen.f32)
        )
      ),
      // if it is larger than 4 in squared norm, it escaped
      module.if(
        module.f32.ge(
          module.f32.add(
            module.f32.mul(
              module.get_local(6, Binaryen.f32),
              module.get_local(6, Binaryen.f32)
            ),
            module.f32.mul(
              module.get_local(7, Binaryen.f32),
              module.get_local(7, Binaryen.f32)
            )
          ),
          module.get_local(3, Binaryen.f32)
        ),
        // return how many iterations it survived, brighter for
        // longer
        module.return(
          module.get_local(8, Binaryen.i32)
        )
      ),
      // if we reached the max iterations, stop
      module.if(
        module.i32.ge_u(
          module.get_local(8, Binaryen.i32),
          module.i32.const(MAX_ITERS_PER_PIXEL)
        ),
        module.return(
          module.i32.const(0) // black, we did not diverge
        )
      ),
      // keep going
      module.set_local(8,
        module.i32.add(
          module.get_local(8, Binaryen.i32),
          module.i32.const(1)
        )
      ),
      module.set_local(4, module.get_local(6, Binaryen.f32)),
      module.set_local(5, module.get_local(7, Binaryen.f32)),
      module.br('main-loop')
    ])),
  ],
  Binaryen.none
);

// Create the add function
module.addFunction('mandelbrot', iffff, [Binaryen.f32, Binaryen.f32, Binaryen.f32, Binaryen.f32, Binaryen.i32], body);

// Export the function, so we can call it later (for simplicity we
// export it as the same name as it has internally)
module.addFunctionExport('mandelbrot', 'mandelbrot');

// Optimize the module! This adds tee_local, removes a return, etc.
module.optimize();

// Get the binary in typed array form
var binary = module.emitBinary();
console.log('binary size: ' + binary.length);

// We don't need the Binaryen module anymore, so we can tell it to
// clean itself up
module.dispose();

// Compile the binary and create an instance
var wasm = new WebAssembly.Instance(new WebAssembly.Module(binary), {})

function draw() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var data = image.data;
  var counter = 0;
  function drawItAll() {
    var pixels = [];
    for (var x = 0; x < image.width; x++) {
      for (var y = 0; y < image.height; y++) {
        pixels.push({ x : x, y : y });
      }
    }
    // fancy semi-shuffle
    for (var i = 0; i < pixels.length; i++) {
      var j = Math.floor(Math.random() * (pixels.length - i));
      var t = pixels[i];
      pixels[i] = pixels[j];
      pixels[j] = t;
    }
    function iter() {
      if (pixels.length === 0) {
        // all done! draw it all again, with different colors
        R_POW_FACTOR += 0.25*Math.cos(counter / 2) - 0.05;
        R_POW_FACTOR = Math.max(1, R_POW_FACTOR);
        G_POW_FACTOR += 0.05*Math.cos(counter / 3);
        B_POW_FACTOR += 0.125*Math.sin(counter / 4);
        counter++;
        drawItAll();
        return;
      }
      for (var i = 0; i < PIXELS_PER_FRAME && pixels.length > 0; i++) {
        var pixel = pixels.pop();
        var xFraction = pixel.x / image.width;
        var yFraction = pixel.y / image.height;
        var x = UPPER_LEFT.x + xFraction * (LOWER_RIGHT.x - UPPER_LEFT.x);
        var y = UPPER_LEFT.y + yFraction * (LOWER_RIGHT.y - UPPER_LEFT.y);
        var value = wasm.exports.mandelbrot(x, y, 2.5 - 0.5*Math.cos(counter / 20), 3 + 2*Math.random());
        var xPixel = Math.round(xFraction * image.width);
        var yPixel = Math.round(yFraction * image.height);
  //alert(x + ' ' + y + '         ' + value);
        var offset = 4 * (xPixel + yPixel * image.width); // RGBA
        var colorFraction = Math.min(value / COLOR_FACTOR, 1);
        data[offset] = Math.pow(colorFraction, R_POW_FACTOR) * 255;
        data[offset + 1] = Math.pow(colorFraction, G_POW_FACTOR) * 255;
        data[offset + 2] = Math.pow(colorFraction, B_POW_FACTOR) * 255;
        data[offset + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      setTimeout(iter, 1);
    }
    setTimeout(iter, 0);
  }
  drawItAll();
}

