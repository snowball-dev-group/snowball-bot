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

gulp.task("necessary-copying", () => {
    return Promise.all([
        gulp
            .src([
                "package{,-lock}.json",
                "src/**/*.*",
                "!src/**/*.{ts,md}",
                "!src/**/.git/*",
                "docker/{.,}[Dd]ocker*{,.*}"
            ])
            .pipe(gulp.dest(`${destFolder}/`)),
        gulp
            .src([
                "docker/images/db/**/*{,.*}"
            ])
            .pipe(gulp.dest(`${destFolder}/.docker/db/`)),
        gulp
            .src([
                "docker/images/bot/Dockerfile"
            ])
            .pipe(gulp.dest(`${destFolder}/`))
    ]);
});

gulp.task("build", gulp.series([
    "compile",
    "necessary-copying"
]));

gulp.task("lint", () => {
    const gulpTslint = require("gulp-tslint");
    const tslint = require("tslint");

    const program = tslint.Linter.createProgram("tsconfig.json");

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
