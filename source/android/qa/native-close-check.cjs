'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const javaRoot=process.env.KAREVO_JAVA_HOME||process.env.BULTEN_JAVA_HOME||process.env.JAVA_HOME;
if(!javaRoot)throw Error('Set JAVA_HOME or KAREVO_JAVA_HOME to the installed JDK.');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bulten-native-close-'));
try {
 execFileSync(path.join(javaRoot,'bin/javac'),['--release','8','-Xlint:-options','-d',folder,path.join(__dirname,'../native/src/com/karevo/studio/CloseRequest.java'),path.join(__dirname,'CloseRequestCheck.java')],{stdio:'inherit'});
 execFileSync(path.join(javaRoot,'bin/java'),['-cp',folder,'com.karevo.studio.CloseRequestCheck'],{stdio:'inherit'});
} finally { fs.rmSync(folder,{recursive:true,force:true}); }
