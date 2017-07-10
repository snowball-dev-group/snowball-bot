module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        ts: {
            default: {
                tsconfig: true,
                options: {
                    fast: "always"
                }
            }
        },
        copy: {
            default: {
                files: [{
                    expand: true,
                    src: ["src/languages/*.json"],
                    dest: "out/languages/",
                    flatten: true,
                    filter: 'isFile'
                }, {
                    expand: true,
                    src: ["src/run.sh", "src/run.bat"],
                    dest: "out/",
                    flatten: true,
                    filter: "isFile"
                }]
            }
        }
    });

    grunt.loadNpmTasks("grunt-ts");
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.registerTask("default", ["ts", "copy"]);
};