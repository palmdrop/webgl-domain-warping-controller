import GLC from './GLC'

// Shaders imported using glslify
import vertexShaderSource from '../GL/shaders/simple.vert'
import fragmentShaderSource from '../GL/shaders/warp.frag'

import postProcessShaderSource from '../GL/shaders/post.frag'

import { getDefaultAttributes, getRandomAttributes } from './ControllerAttributes';

class TextureController {
    ////////////////////
    // INITIALIZATION //
    ////////////////////
    constructor() {
        // Helper function for calculating a random offset
        // The random offset is used to ensure that the different noise
        // functions do not have the same origin. This also doubles as a random seed
        const randomOffset = () => {
            return [Math.random() * 1000, Math.random() * 1000, 1.0];
        };

        // A reference to the canvas element that holds the WebGL context
        this.canvas = null;

        // Set to true once the controller is initialized
        // Many actions are unavailable until then
        this.initialized = false;

        // The ID of the shader program
        this.program = -1;

        this.programs = {
            layerProgram: -1,
            warpProgram: -1
        };

        // Random offsets for each layer
        this.sourceOffset = randomOffset();
        this.angleOffset  = randomOffset();
        this.amountOffset = randomOffset();

        // The position of the internal view and the dimensions of the canvas
        this.position = [0, 0];
        this.dimensions = [window.innerWidth, window.innerHeight];

        // Time and pause state for animation
        this.paused = false; // No time is updated if paused is set to true
        this.sourceTime = 0.0;
        this.angleControlTime = 0.0;
        this.amountControlTime = 0.0;

        // Current attributes of the texture controller
        // These are the general settings of the shader, and most of them directly correspond
        // to shader uniforms. 
        this.attributes = 
            //getRandomAttributes();
            getDefaultAttributes();
        this.defaultAttributes = getDefaultAttributes();

        this.previousResolution = 1.0;

        // Used for saving the canvas as an image
        this.captureNext = false; // True if next frame should be captured
        this.dataCallback = null; // The callback function that should be used to return the contents 
                                  // of the render

        // Values used for multisampling
        // A framebuffer is used and a texture with double the size of the canvas is 
        // bound as render texture. This texture is then downsampled using linear filtering
        // to achieve a multisampling effect
        this.multisamplingMultiplier = 2.0; 
        this.multisamplingDimensions = [-1, -1];
        this.fbo = -1;
    }

    isInitialized() {
        return this.initialized;
    }

    _createShader(vertexShaderSource, fragmentShaderSource) {
        const program = GLC.createShaderProgram(vertexShaderSource, fragmentShaderSource);
        GLC.flush();
        if(!this.program) {
            throw new Error("Shader not created");
        }
        return program;
    }

    // Initializes the WebGL context and loads the GPU with vertex data
    initialize(canvas) {
        if(this.initialized) {
            console.log("The texture controller is already initialized");
            return true;
        }

        // INITIALIZE GLC (HELPER CLASS)
        console.log("Initializing webgl controller (GLC)");

        // This class is used as a facade against the webgl context
        if(!GLC.init(canvas)) {
            throw new Error("GLC failed to initialize");
        }
        this.canvas = canvas;

        // COMPILE SHADERS
        console.log("Compiling shaders");

        // Create the shader program using the imported shaders
        this.program = this._createShader(vertexShaderSource, fragmentShaderSource);
        this.postProcessingProgram = this._createShader(vertexShaderSource, postProcessShaderSource);

        // Setup full screen quad
        console.log("Initializing vertex data");

        GLC.createFullScreenQuad();
        GLC.setQuadAttributeLayout(this.program, "vertPosition");
        GLC.setQuadAttributeLayout(this.postProcessingProgram, "vertPosition", "inTexCoord");

        // SET SHADER UNIFORMS 
        console.log("Setting uniforms");

        GLC.setShaderProgram(this.program);
        this._setUniforms();

        // Finally, set internal states
        console.log("Done initializing texture controller");

        this.initialized = true;

        // Sets up frame buffer for multisampling
        this._setupFramebuffer();

        return true;
    };

    // Initialize a frame buffer using the current dimensions
    // Used for multisampling
    _setupFramebuffer() {
        // If initialzied, delete the existing texture and frame buffer
        if(this.renderTexture) {
            GLC.deleteTexture(this.renderTexture);
            GLC.deleteFramebuffer(this.fbo);
        }

        // Calculate the dimensions of the multisample texture
        this.multisamplingDimensions = [
            this.dimensions[0] * this.multisamplingMultiplier,
            this.dimensions[1] * this.multisamplingMultiplier
        ];

        //console.log(this.multisamplingDimensions[0] + " " + this.multisamplingDimensions[1]);

        // Create the render texture
        this.renderTexture = GLC.createTexture(this.multisamplingDimensions[0], this.multisamplingDimensions[1]);

        // Create the frame buffer
        this.fbo = GLC.createFramebuffer(this.renderTexture);
    }

    ///////////////////
    // IMPORT/EXPORT //
    ///////////////////

    // Exports the attributes as a JSON file
    exportSettings() {
        return JSON.stringify(this.attributes, null, 2);
    }

    // Import new attributes from a JSON string
    importSettings(jsonString) {
        // Merge the current settings object, which holds the correct format of the settings,
        // with a saved, possibly older version. 
        // The current object will take precedence: a property not existing in current, but existing in changes,
        // will not be added to the updated object
        const mergeSettings = (current, changes) => {
            // Check if the current object is a single value or an array. In that case, update, if 
            // an updated value exists
            if(typeof current !== "object" || Array.isArray(current)) return changes || current;

            // If the changes are null or undefined, use the current object
            if(!changes) return current;

            var updated = {};

            // Iterate over all the properties in the current object, and merge each
            // property with the corresponding property in the changes object
            for(var prop in current) {
                if(Object.prototype.hasOwnProperty.call(current, prop)) {
                    updated[prop] = mergeSettings(current[prop], changes[prop]);
                }
            }

            return updated;
        }
        
        var imported = JSON.parse(jsonString);

        // Use default settings when merging
        this.attributes = mergeSettings(getDefaultAttributes(), imported);

        // Update all uniforms with the new settings
        this._setUniforms();
    }

    // Used to capture the next frame of animation
    // The data callback function will be used to return the result
    captureFrame(dataCallback) {
        this.captureNext = true;
        this.dataCallback = dataCallback;
    }

    /////////////////////
    // DATA MANAGEMENT //
    /////////////////////

    // Used to fetch the attribute data of a specific location
    // Should probably only be used internally
    _getAttribute(attributes, location) {
        // Helper function for checking if an object contains a specific property
        const hasProperty = (object, property) => {
            return Object.prototype.hasOwnProperty.call(object, property);
        }

        var subLocations = location.split(".");

        // Check if attribute exists in main attributes object
        if(!hasProperty(attributes, subLocations[0])) return undefined;

        // Get the current attribute
        var currentAttribute = attributes[subLocations[0]];

        // If there's more sub-locations in the query, iterate through them
        // until the bottom level is found
        for(var i = 1; i < subLocations.length; i++) {
            // Verify that the new attribute is an object (if not, the query is invalid)
            if(!(typeof currentAttribute === "object")) return undefined;

            // Check if the attribute contains the requested attribute 
            if(!hasProperty(currentAttribute.value, subLocations[i])) return undefined;

            // Get the value property of the attribute, since this will contain the next iteration
            currentAttribute = currentAttribute.value[subLocations[i]];
        }

        // Returns an array where the first element specifies if the attribute has a corresponding
        // shader uniform, and the second element is the data itself
        return [attributes[subLocations[0]].isUniform, currentAttribute];
    }

    // Set all the uniforms from the attributes object
    // Should only be used internally
    _setUniforms() {
        // Helper function for setting a specific uniform, if it exists
        // Recursively sets all sub-attributes
        const setUniform = (attribute, name) => {
            // Return if the value has no corresponding uniform, or if the texture controller is not initialized
            // Also, if the root level object is a uniform, assume all children are too
            if(!attribute.isUniform) return;

            // Recursively sets all sub-attributes' corresponding uniforms 
            const setAll = (current, location) => {
                // If the value property of the attribute is an object, then
                // more sub-attributes exist
                if(typeof current.value === "object") {
                    // Iterate over all sub-attributes
                    for(var name in current.value) {
                        if(Object.prototype.hasOwnProperty.call(current.value, name)) {
                            // And set all their corresponding uniforms
                            // The "." symbol is used to construct the uniform location
                            setAll(current.value[name], location + "." + name);
                        }
                    }
                // If the value property is not an object, a leaf has been reached and we can set
                // the attribute uniform directly
                } else {
                    GLC.setUniform(this.program, location, current.type, current.value);
                }
            };

            setAll(attribute, name);
        }

        // Iterate over all attributes and set their coorresponding uniforms
        for (var name in this.attributes) {
            if(Object.prototype.hasOwnProperty.call(this.attributes, name)) {
                setUniform(this.attributes[name], name);
            }
        }
    }

    // Returns a value from the attribute object
    // Used to query the internal state of the texture controller
    getValue(name) {
        const [, v] = this._getAttribute(this.attributes, name);
        if(typeof v === "undefined") return undefined;
        return v.value;
    }

    // Returns the default (initial) value
    getDefault(name) {
        const [, v] = this._getAttribute(this.defaultAttributes, name);
        if(typeof v === "undefined") return undefined;
        return v.value;
    }

    getDimensions() {
        return this.dimensions;
    }

    getPosition() {
        return this.position;
    }

    

    // Updates a value and it's corresponding uniform (if such exists)
    updateValue(name, v) {
        //TODO create some form of callback to sliders that force them to re-read when a value is changed?!

        // Find the requested attribute, or return if it does not exist
        const [isUniform, attribute] = this._getAttribute(this.attributes, name);
        if(typeof v === "undefined") return -1;

        // Do nothing if the value is unchanged
        if(attribute.value === v) return;

        // Set the new value, and set the corresponding uniform
        attribute.value = v;

        if(isUniform) {
            GLC.setUniform(this.program, name, attribute.type, attribute.value);
        } 
    }

    // Set position of internal view
    setPosition(position) {
        if(!this.initialized) return;

        // Update controller reference
        this.position[0] = position[0];
        this.position[1] = position[1];
        
        // And set the corresponding uniform
        GLC.setShaderProgram(this.program);
        GLC.setUniform(this.program, "position", "2fv", position);
    }

    // Pauses and unpauses the animation
    setPaused(paused) {
        this.paused = paused;
    }

    _handleUpdate() {
        const oldWidth = this.dimensions[0];
        const oldHeight = this.dimensions[1];

        const resolution = this.getValue("resolution");

        // Set the dimensions to that of the inner window size, since the canvas covers everything
        const newWidth      = resolution * window.innerWidth;
        const newHeight     = resolution * window.innerHeight;
        const newDimensions = [newWidth, newHeight];

        // Update the position to preserve the center of the view on resize
        /*const position = this.getPosition();
        const offset = this.screenSpaceToViewSpace([
            0,
            (newHeight - oldHeight) / 4.0
        ]);

        this.setPosition([position[0] + offset[0], position[1] + offset[1]]);
        */

        // Update values
        GLC.setViewport(newWidth, newHeight);
        this.canvas.style.width = window.innerWidth;
        this.canvas.style.height = window.innerHeight;

        this.canvas.width = newWidth;
        this.canvas.height = newHeight;

        GLC.setUniform(this.program, "viewport", "2fv", newDimensions);

        this.dimensions = newDimensions;
        this.previousResolution = resolution;

        // Re-create the framebuffer and render texture to fit the new size
        if(oldWidth !== newWidth || oldHeight !== newHeight || resolution !== this.previousResolution) {
            this._setupFramebuffer();
        }
    }

    //////////////
    // RESIZING //
    //////////////

    handleResize() {
        if(!this.initialized) return;

        this._handleUpdate();
    }

    screenSpaceToViewSpace(position) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Calculate the proportions of the screen
        const proportions = height / width;

        // Scale and correct for proportions
        return [position[0] / width, position[1] * proportions / height];
    }

    ///////////////
    // RENDERING //
    ///////////////

    // Render to the canvas
    render(delta) {
        GLC.setShaderProgram(this.program);

        // Do not increment time if the animation is paused
        if(!this.paused) {
            // Increment the "time" based on the time passed since last frame 
            const animationSpeed = this.getValue("animationSpeed.general");
            this.sourceTime        += animationSpeed * this.getValue("animationSpeed.source") * delta;
            this.angleControlTime  += animationSpeed * this.getValue("animationSpeed.angleControl") * delta;
            this.amountControlTime += animationSpeed * this.getValue("animationSpeed.amountControl") * delta;
        }

        // Update shader uniforms
        GLC.setUniform(this.program, "source.offset",        "3fv", [this.sourceOffset[0], this.sourceOffset[1], this.sourceTime]);
        GLC.setUniform(this.program, "angleControl.offset",  "3fv", [this.angleOffset[0],  this.angleOffset[1], this.angleControlTime]);
        GLC.setUniform(this.program, "amountControl.offset", "3fv", [this.amountOffset[0], this.amountOffset[1], this.amountControlTime]);

        if(this.getValue("multisampling")) {
            // Bind the frame buffer dedicated to multisampling
            // We'll now render to a separate texture
            GLC.bindFramebuffer(this.fbo);

            // Set the view port to the extended dimensions
            GLC.setViewport(this.multisamplingDimensions[0], this.multisamplingDimensions[1]); 
            GLC.setUniform(this.program, "viewport", "2fv", this.multisamplingDimensions);

            // Render to the frame buffer
            GLC.renderFullScreenQuad(this.program);

            // Bind the default frame buffer
            GLC.bindFramebuffer(null);
            GLC.setViewport(this.canvas.width, this.canvas.height); 

            // Use the post processing program, which will sample the texture which we previously rendered to
            GLC.setShaderProgram(this.postProcessingProgram);

            // Bind and activate the texture
            GLC.setTexture(this.renderTexture, 0);

            // Tell the shader we bound the texture to texture unit 0
            //gl.uniform1i(programInfo.uniformLocations.uSampler, 0);
            GLC.setUniform(this.postProcessingProgram, "texture", "1i", 0);

            GLC.renderFullScreenQuad(this.postProcessingProgram);
        } else {
            GLC.bindFramebuffer(null);
            GLC.setViewport(this.canvas.width, this.canvas.height); 
            GLC.setUniform(this.program, "viewport", "2fv", this.dimensions);
            GLC.setUniform(this.program, "position", "2fv", this.position);

            GLC.setUniform(this.program, "scale", "1f", this.getValue("scale"));

            // Render
            GLC.renderFullScreenQuad(this.program);
        }

        GLC.setShaderProgram(this.program);

        // Capture the frame if requested
        if(this.captureNext) {
            this.captureNext = false;
            var captureData = this.canvas.toDataURL("image/png");
            this.dataCallback(captureData);
        }
    }
}

// Initialize a global instance of the texture controller, and export
const TXC = new TextureController();
export default TXC;