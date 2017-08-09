module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        ts: {
            default: {
                tsconfig: true,
                options: {
                    fast: "never"
                }
            }
        },
        tslint: {
            default: {
                options: {
                    configuration: "tslint.json",
                    force: false,
                    fix: false
                },
                files: {
                    src: ["src/**/*.ts"]
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
                }, {
                    expand: true,
                    src: ["package.json"],
                    dest: "out/",
                    flatten: true,
                    filter: 'isFile'
                }]
            }
        }
    });

    grunt.loadNpmTasks("grunt-ts");
    grunt.loadNpmTasks("grunt-tslint");
    grunt.loadNpmTasks('grunt-contrib-copy');

    grunt.registerTask("default", ["tslint", "ts", "copy"]);
};