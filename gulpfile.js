// #region Configuration area

// output folder
const destFolder = "out";

// #endregion

// #region Gulp script

const gulp = require("gulp");


gulp.task("compile", () => {
    const gruntTypeScript = require("gulp-typescript");
    const tsProject = gruntTypeScript.createProject("tsconfig.json");

    return tsProject.src()
        .pipe(tsProject())
        .js.pipe(gulp.dest(destFolder));
});

gulp.task("copy-langfiles", () => {
    return gulp.src(["src/languages/*.json"])
        .pipe(gulp.dest(`${destFolder}/languages/`))
});

gulp.task("copy-runscripts", () => {
    return gulp.src(["src/run.bat", "src/run.sh", "package.json", "package-lock.json"])
        .pipe(gulp.dest(`${destFolder}/`))
});

gulp.task("necessary-copying", gulp.series(["copy-langfiles", "copy-runscripts"]));

gulp.task("build", gulp.series(["compile", "necessary-copying"]));

gulp.task("lint", () => {
    const gulpTslint = require("gulp-tslint");
    const tslint = require("tslint");

    const program = tslint.Linter.createProgram("./tsconfig.json");

    return gulp.src("src/**/*.ts", { base: '.' })
        .pipe(gulpTslint({
            formatter: "prose",
            program
        }))
        .pipe(gulpTslint.report({
            allowWarnings: true,
            summarizeFailureOutput: true
        }));
});

gulp.task("default", gulp.series(["lint", "build"]));

// #endregion
